// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package plugin

import (
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
