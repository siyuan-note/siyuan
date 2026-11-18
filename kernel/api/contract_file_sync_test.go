// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/eventbus"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAPIContractPutFileWaitsForSyncIndexRetry(t *testing.T) {
	const child = "SIYUAN_TEST_PUT_FILE_INDEX_RETRY"
	if os.Getenv(child) == "" {
		// 索引事件的订阅仅在子进程内有效。
		cmd := exec.Command(os.Args[0], "-test.run=^TestAPIContractPutFileWaitsForSyncIndexRetry$", "-test.timeout=35s")
		cmd.Env = append(os.Environ(), child+"=1")
		if output, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("sync index retry failed: %v\n%s", err, output)
		}
		return
	}

	root := t.TempDir()
	util.WorkspaceDir, util.DataDir = root, filepath.Join(root, "data")
	util.RepoDir, util.HistoryDir = filepath.Join(root, "repo"), filepath.Join(root, "history")
	util.ConfDir, util.TempDir = filepath.Join(root, "conf"), filepath.Join(root, "temp")
	cloudDir := filepath.Join(t.TempDir(), "cloud")
	const target = "/storage/petal/probe/settings.json"
	const ignoredTarget = "/storage/petal/probe/ignored.json"
	targetPath := filepath.Join(util.DataDir, target)
	for _, dir := range []string{util.ConfDir, cloudDir, filepath.Dir(targetPath), filepath.Join(util.DataDir, ".siyuan")} {
		if err := os.MkdirAll(dir, 0755); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(targetPath, []byte("initial"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(util.DataDir, ".siyuan", "syncignore"), []byte(ignoredTarget+"\n"), 0644); err != nil {
		t.Fatal(err)
	}
	model.Conf = model.NewAppConf()
	model.Conf.Repo.Store(conf.NewRepo())
	model.Conf.Repo.Load().Key = bytes.Repeat([]byte{17}, 32)
	model.Conf.System.Store(conf.NewSystem())
	model.Conf.System.Load().ID = "put-file-index-retry"
	syncConf := conf.NewSync()
	syncConf.Enabled, syncConf.Perception = true, false
	syncConf.Provider, syncConf.CloudName = conf.ProviderLocal, "main"
	syncConf.Local = &conf.Local{Endpoint: cloudDir}
	model.Conf.Sync.Store(syncConf)
	model.Conf.SetUser(&conf.User{UserId: "put-file-index-retry", UserSiYuanOneTimePayStatus: 1})
	util.StatusBarCfg.Store(&util.StatusBar{MsgDataSyncDisabled: true})

	const endpoint = "/api/file/putFile"
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	engine.Use(model.ControlConcurrency, func(c *gin.Context) {
		c.Set(model.RoleContextKey, model.RoleAdministrator)
	})
	engine.POST(endpoint, contractRouteHandlers(apicontract.PutFile, putFile)...)
	upload := func(ctx context.Context, path, content string) *httptest.ResponseRecorder {
		body, media := putFileMultipartBody(t, path, []byte(content))
		request := httptest.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
		request.Header.Set("Content-Type", media)
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, request)
		return recorder
	}
	checkResponse := func(response *httptest.ResponseRecorder, code int) {
		t.Helper()
		requireAPIContract(t, http.MethodPost, endpoint, response)
		var result struct{ Code int }
		if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil || result.Code != code {
			t.Fatalf("expected code %d, got %s (%v)", code, response.Body, err)
		}
	}

	// 每次扫描读取文件属性后保存设置，直到 DejaVu 用完索引尝试次数。
	const attempts = 7
	scans := 0
	retryStarted, continueRetry := make(chan struct{}), make(chan struct{})
	resume := sync.OnceFunc(func() { close(continueRetry) })
	defer resume()
	if err := eventbus.Subscribe(eventbus.EvtIndexWalkData, func(_ map[string]any, path string) {
		if path != target {
			return
		}
		scans++
		if scans <= attempts {
			response := upload(context.Background(), "/data"+target, fmt.Sprintf("change %d", scans))
			var result struct{ Code int }
			if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil || result.Code != 0 {
				t.Errorf("competing write failed: %s (%v)", response.Body, err)
			}
		}
		if scans == attempts+1 {
			close(retryStarted)
			<-continueRetry
		}
	}); err != nil {
		t.Fatal(err)
	}
	syncDone := make(chan error, 1)
	go func() { syncDone <- model.SyncDataUpload() }()
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	select {
	case <-retryStarted:
	case err := <-syncDone:
		t.Fatalf("sync finished before the protected retry: %v", err)
	case <-ctx.Done():
		t.Fatal("sync did not start the index retry")
	}

	startUpload := func(ctx context.Context, path, content string) <-chan *httptest.ResponseRecorder {
		t.Helper()
		waiting := make(chan struct{})
		observed := &putFileWaitContext{Context: ctx, reached: sync.OnceFunc(func() { close(waiting) })}
		result := make(chan *httptest.ResponseRecorder, 1)
		go func() { result <- upload(observed, path, content) }()
		select {
		case <-waiting:
		case <-ctx.Done():
			t.Fatal("upload did not reach the retry lock")
		}
		return result
	}
	canceledCtx, cancelUpload := context.WithCancel(ctx)
	defer cancelUpload()
	const canceledPath = "/data/storage/petal/probe/canceled.json"
	canceled := startUpload(canceledCtx, canceledPath, "canceled")
	cancelUpload()
	select {
	case response := <-canceled:
		checkResponse(response, -1)
	case <-ctx.Done():
		t.Fatal("cancelled upload was left waiting")
	}
	if _, err := os.Stat(filepath.Join(root, canceledPath)); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("cancelled upload changed the destination: %v", err)
	}
	queued := startUpload(ctx, "/data"+target, "queued")
	checkResponse(upload(ctx, "/temp/probe.json", "temporary"), 0)
	checkResponse(upload(ctx, "/data"+ignoredTarget, "ignored"), 0)
	assertPutFileContent(t, targetPath, []byte("change 7"))
	resume()
	select {
	case err := <-syncDone:
		if err != nil || scans != attempts+1 {
			t.Fatalf("protected retry returned %v after %d scans", err, scans)
		}
	case <-ctx.Done():
		t.Fatal("sync did not finish")
	}
	select {
	case response := <-queued:
		checkResponse(response, 0)
	case <-ctx.Done():
		t.Fatal("upload did not resume")
	}
	assertPutFileContent(t, targetPath, []byte("queued"))
}

type putFileWaitContext struct {
	context.Context
	reached func()
}

func (c *putFileWaitContext) Done() <-chan struct{} {
	c.reached()
	return c.Context.Done()
}
