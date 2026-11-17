// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package plugin

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/siyuan/kernel/util"
	"golang.org/x/sys/windows"
)

func TestPluginDocumentResponseAccessDenied(t *testing.T) {
	restoreToken := pluginTestWithoutPrivileges(t)
	defer restoreToken()
	filename := filepath.Join(newPluginServiceWorkspace(t), "denied.sy")
	if err := os.WriteFile(filename, []byte("private"), 0600); err != nil {
		t.Fatal(err)
	}
	original, err := windows.GetNamedSecurityInfo(filename, windows.SE_FILE_OBJECT, windows.DACL_SECURITY_INFORMATION)
	if err != nil {
		t.Fatal(err)
	}
	oldACL, _, err := original.DACL()
	if err != nil {
		t.Fatal(err)
	}
	denied, err := windows.SecurityDescriptorFromString("D:P(D;;FR;;;WD)(A;;FA;;;WD)")
	if err != nil {
		t.Fatal(err)
	}
	newACL, _, err := denied.DACL()
	if err != nil {
		t.Fatal(err)
	}
	if err = windows.SetNamedSecurityInfo(filename, windows.SE_FILE_OBJECT, windows.DACL_SECURITY_INFORMATION|windows.PROTECTED_DACL_SECURITY_INFORMATION, nil, nil, newACL, nil); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := windows.SetNamedSecurityInfo(filename, windows.SE_FILE_OBJECT, windows.DACL_SECURITY_INFORMATION|windows.UNPROTECTED_DACL_SECURITY_INFORMATION, nil, nil, oldACL, nil); err != nil {
			t.Error(err)
		}
		runtime.KeepAlive(original)
	})
	runtime.KeepAlive(denied)
	if source, openErr := os.Open(filename); openErr == nil {
		source.Close()
		t.Fatal("access-denied fixture is readable")
	} else if !errors.Is(openErr, os.ErrPermission) {
		t.Fatalf("access-denied fixture returned an unexpected error: %v", openErr)
	}
	engine := gin.New()
	engine.GET("/document", func(c *gin.Context) { servePluginServiceFile(c, "test", filename, "download.sy") })
	recorder := httptest.NewRecorder()
	engine.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/document", nil))
	if recorder.Code != http.StatusForbidden || recorder.Body.String() != "[plugin:test] file access denied" {
		t.Fatalf("unreadable source response changed: %d %q", recorder.Code, recorder.Body.String())
	}
	if recorder.Header().Get("Content-Disposition") != "" {
		t.Fatal("unreadable source was returned as a download")
	}
}

func pluginTestWithoutPrivileges(t *testing.T) func() {
	t.Helper()
	// MSYS2 管理员进程启用的备份特权会绕过 DACL；仅在当前测试线程使用无特权的身份副本。
	runtime.LockOSThread()
	var original windows.Token
	if err := windows.OpenThreadToken(windows.CurrentThread(), windows.TOKEN_QUERY|windows.TOKEN_IMPERSONATE|windows.TOKEN_DUPLICATE, true, &original); err != nil && err != windows.ERROR_NO_TOKEN {
		runtime.UnlockOSThread()
		t.Fatal(err)
	}
	source := original
	if source == 0 {
		if err := windows.OpenProcessToken(windows.CurrentProcess(), windows.TOKEN_QUERY|windows.TOKEN_DUPLICATE, &source); err != nil {
			runtime.UnlockOSThread()
			t.Fatal(err)
		}
		defer source.Close()
	}
	var restricted windows.Token
	err := windows.DuplicateTokenEx(source, windows.TOKEN_QUERY|windows.TOKEN_ADJUST_PRIVILEGES|windows.TOKEN_IMPERSONATE, nil, windows.SecurityImpersonation, windows.TokenImpersonation, &restricted)
	if err == nil {
		err = windows.AdjustTokenPrivileges(restricted, true, nil, 0, nil, nil)
	}
	if err == nil {
		err = windows.SetThreadToken(nil, restricted)
	}
	if err != nil {
		restricted.Close()
		original.Close()
		runtime.UnlockOSThread()
		t.Fatal(err)
	}
	return func() {
		defer restricted.Close()
		defer original.Close()
		if err := windows.SetThreadToken(nil, original); err != nil {
			// 恢复失败时保持线程绑定，避免受限身份被其他测试复用。
			t.Error(err)
			return
		}
		runtime.UnlockOSThread()
	}
}

func TestPluginDocumentResponseWaitsForWindowsPathAlias(t *testing.T) {
	workspace := newPluginServiceWorkspace(t)
	oldTemp := util.TempDir
	util.TempDir = t.TempDir()
	t.Cleanup(func() { util.TempDir = oldTemp })
	filename := filepath.Join(workspace, "document.sy")
	if err := os.WriteFile(filename, []byte("original"), 0600); err != nil {
		t.Fatal(err)
	}
	alias := strings.ToUpper(filename)
	filelock.Lock(alias)
	locked := true
	engine := gin.New()
	started, finished := make(chan struct{}), make(chan struct{})
	engine.GET("/document", func(c *gin.Context) {
		response := pluginServiceHTTPResponse(nil, c, "test", &HttpResponse{
			Body: &ResponseBody{File: &ResponseFile{Path: filename}},
		})
		close(started)
		serviceTestWrite(c, response)
	})
	recorder := httptest.NewRecorder()
	go func() {
		defer close(finished)
		engine.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/document", nil))
	}()
	defer func() {
		if locked {
			filelock.Unlock(alias)
		}
		<-finished
	}()
	<-started
	select {
	case <-finished:
		t.Fatal("plugin snapshot bypassed the document writer's path alias")
	case <-time.After(30 * time.Millisecond):
	}
	if err := os.WriteFile(filename, []byte("committed"), 0600); err != nil {
		t.Fatal(err)
	}
	filelock.Unlock(alias)
	locked = false
	select {
	case <-finished:
	case <-time.After(5 * time.Second):
		t.Fatal("plugin snapshot did not resume after the writer released its alias")
	}
	if recorder.Code != http.StatusOK || recorder.Body.String() != "committed" {
		t.Fatalf("plugin snapshot did not capture committed data: %d %q", recorder.Code, recorder.Body.String())
	}
}
