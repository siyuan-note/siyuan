// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build (sqlcipher || libsqlcipher) && cgo

package server

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/util"
)

type tiffBlockedWriter struct {
	*httptest.ResponseRecorder
	ready, release chan struct{}
	once           sync.Once
}

func (w *tiffBlockedWriter) Write(data []byte) (int, error) {
	w.once.Do(func() { close(w.ready) })
	<-w.release
	return w.ResponseRecorder.Write(data)
}

func TestServeTIFFEncryptedLifecycle(t *testing.T) {
	const helper = "SIYUAN_TEST_TIFF_ENCRYPTED"
	if os.Getenv(helper) != "1" {
		// 独立进程隔离数据库和密钥状态，不访问运行中的工作空间。
		ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
		defer cancel()
		command := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestServeTIFFEncryptedLifecycle$", "-test.v")
		command.Env = append(os.Environ(), helper+"=1")
		if output, err := command.CombinedOutput(); err != nil {
			t.Fatalf("encrypted TIFF subprocess: %v\n%s", err, output)
		}
		return
	}
	root := filepath.Join(t.TempDir(), "notes#1")
	util.WorkspaceDir = root
	util.DataDir, util.TempDir, util.ConfDir, util.HistoryDir = filepath.Join(root, "data"), filepath.Join(root, "temp"), filepath.Join(root, "conf"), filepath.Join(root, "history")
	util.QueueDir = filepath.Join(util.TempDir, "queue")
	util.DBPath, util.HistoryDBPath = filepath.Join(util.TempDir, util.DBName), filepath.Join(util.TempDir, "history.db")
	util.AssetContentDBPath, util.BlockTreeDBPath = filepath.Join(util.TempDir, "asset_content.db"), filepath.Join(util.TempDir, "blocktree.db")
	for _, directory := range []string{util.DataDir, util.TempDir, util.ConfDir, util.HistoryDir} {
		if err := os.MkdirAll(directory, 0700); err != nil {
			t.Fatal(err)
		}
	}
	model.Conf = model.NewAppConf()
	model.Conf.NotebookCrypto = conf.NewNotebookCrypto()
	model.Conf.FileTree.Store(conf.NewFileTree())
	model.Conf.Sync.Store(conf.NewSync())
	model.Conf.System.Store(conf.NewSystem())
	model.Conf.Editor.Store(conf.NewEditor())
	model.Conf.Search.Store(conf.NewSearch())
	model.Conf.Export.Store(conf.NewExport())
	sql.InitDatabase(true)
	sql.InitHistoryDatabase(true)
	sql.InitAssetContentDatabase(true)
	defer sql.CloseDatabase()
	const password = "TIFF preview regression"
	if err := model.EnableEncryptedNotebook(password); err != nil {
		t.Fatal(err)
	}
	boxID, err := model.CreateEncryptedBox("TIFF previews", password)
	if err != nil {
		t.Fatal(err)
	}
	dek, err := model.GetDEK(boxID)
	if err != nil {
		t.Fatal(err)
	}
	source := tiffSource(t)
	ciphertext, err := model.EncryptAsset(boxID, "preview.tif", "original.tif", dek, source)
	clear(dek)
	if err != nil {
		t.Fatal(err)
	}
	assetPath := filepath.Join(util.DataDir, boxID, "assets", "preview.tif")
	historyPath := filepath.Join(util.HistoryDir, "2026-10-21-120000-update", boxID, "assets", "preview.tif")
	writeTIFFTestFile(t, assetPath, ciphertext)
	writeTIFFTestFile(t, historyPath, ciphertext)
	repoPath := filepath.ToSlash(filepath.Join(boxID, "assets", "preview.tif"))
	previews := openTIFFSnapshots(t, repoPath)
	stagedPath := filepath.Join(util.TempDir, "repo", "diff", filepath.FromSlash(repoPath))
	if staged, err := os.ReadFile(stagedPath); err != nil || !bytes.Equal(staged, ciphertext) {
		t.Fatalf("encrypted snapshot did not preserve ciphertext: %v", err)
	}
	engine := gin.New()
	engine.Use(func(c *gin.Context) { c.Set(model.RoleContextKey, model.RoleAdministrator); c.Next() })
	serveAssets(engine)
	serveRepoDiff(engine)
	urls := []string{
		"/assets/preview.tif?box=" + boxID,
		"/history/2026-10-21-120000-update/" + boxID + "/assets/preview.tif?box=" + boxID,
		previews[repoPath] + "?box=" + boxID,
	}
	for _, url := range urls {
		for _, query := range []string{"", "&style=thumb", "&download=true"} {
			recorder := httptest.NewRecorder()
			engine.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, url+query, nil))
			if query == "&download=true" {
				if recorder.Code != http.StatusOK || !bytes.Equal(recorder.Body.Bytes(), source) {
					t.Fatalf("encrypted original download %s = %d", url, recorder.Code)
				}
			} else {
				assertTIFFPreview(t, recorder)
			}
			if recorder.Header().Get("Cache-Control") != "private, no-store" || recorder.Header().Get("ETag") != "" {
				t.Fatalf("encrypted response may be cached: %v", recorder.Header())
			}
		}
	}
	if _, err := os.Stat(filepath.Join(util.TempDir, "assets-cache", "tiff")); !os.IsNotExist(err) {
		t.Fatal("encrypted TIFF preview leaked to disk cache")
	}
	for _, path := range []string{assetPath, historyPath, stagedPath} {
		before, _ := os.ReadFile(path)
		if !bytes.Equal(before, ciphertext) {
			t.Fatal("preview modified ciphertext")
		}
		corrupt := bytes.Clone(ciphertext)
		corrupt[len(corrupt)-1] ^= 1
		writeTIFFTestFile(t, path, corrupt)
	}
	for _, url := range urls {
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, url, nil))
		if recorder.Code != http.StatusInternalServerError {
			t.Fatalf("authentication failure %s = %d", url, recorder.Code)
		}
	}
	writeTIFFTestFile(t, assetPath, ciphertext)
	writeTIFFTestFile(t, historyPath, ciphertext)
	writeTIFFTestFile(t, stagedPath, ciphertext)
	writer := &tiffBlockedWriter{ResponseRecorder: httptest.NewRecorder(), ready: make(chan struct{}), release: make(chan struct{})}
	var release sync.Once
	defer release.Do(func() { close(writer.release) })
	done := make(chan struct{})
	go func() { engine.ServeHTTP(writer, httptest.NewRequest(http.MethodGet, urls[0], nil)); close(done) }()
	select {
	case <-writer.ready:
	case <-time.After(10 * time.Second):
		t.Fatal("preview never reached response writer")
	}
	locked := make(chan struct{})
	go func() { model.LockBox(boxID); close(locked) }()
	early := false
	select {
	case <-locked:
		early = true
	case <-time.After(300 * time.Millisecond):
	}
	release.Do(func() { close(writer.release) })
	<-done
	select {
	case <-locked:
	case <-time.After(10 * time.Second):
		t.Fatal("notebook lock did not drain preview request")
	}
	if early {
		t.Fatal("preview lease ended before response serialization")
	}
	for _, url := range urls {
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, url, nil))
		if recorder.Code != http.StatusForbidden {
			t.Fatalf("locked encrypted preview %s = %d", url, recorder.Code)
		}
	}
}
