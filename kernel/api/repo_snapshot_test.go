// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/dejavu"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestSnapshotFullCheckHTTP(t *testing.T) {
	previousConf := model.Conf
	workspace, data, repoDir := util.WorkspaceDir, util.DataDir, util.RepoDir
	history, temp, confDir := util.HistoryDir, util.TempDir, util.ConfDir
	status := util.StatusBarCfg.Load()
	t.Cleanup(func() {
		model.Conf = previousConf
		util.WorkspaceDir, util.DataDir, util.RepoDir = workspace, data, repoDir
		util.HistoryDir, util.TempDir, util.ConfDir = history, temp, confDir
		util.StatusBarCfg.Store(status)
	})
	root := t.TempDir()
	util.WorkspaceDir, util.DataDir, util.RepoDir = root, filepath.Join(root, "data"), filepath.Join(root, "repo")
	util.HistoryDir, util.TempDir, util.ConfDir = filepath.Join(root, "history"), filepath.Join(root, "temp"), filepath.Join(root, "conf")
	util.StatusBarCfg.Store(&util.StatusBar{MsgDataSyncDisabled: true})
	model.Conf = model.NewAppConf()
	model.Conf.Repo.Store(conf.NewRepo())
	model.Conf.Sync.Store(conf.NewSync())
	model.Conf.System.Store(conf.NewSystem())
	model.Conf.System.Load().ID = "snapshot-test"
	model.Conf.Repo.Load().Key = bytes.Repeat([]byte{17}, 32)
	model.Conf.Sync.Load().Provider = conf.ProviderLocal
	model.Conf.Sync.Load().Local = &conf.Local{Endpoint: filepath.Join(root, "cloud")}
	if err := os.MkdirAll(util.DataDir, 0755); err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(util.DataDir, "probe.txt")
	stamp := time.Unix(1700000100, 100000000)
	write := func(content string) {
		t.Helper()
		if err := os.WriteFile(file, []byte(content), 0644); err != nil {
			t.Fatal(err)
		}
		if err := os.Chtimes(file, stamp, stamp); err != nil {
			t.Fatal(err)
		}
	}
	engine := gin.New()
	const endpoint = "/api/repo/createSnapshot"
	engine.POST(endpoint, createSnapshot)
	create := func(body string) apicontract.CreateSnapshotData {
		t.Helper()
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, endpoint, strings.NewReader(body)))
		requireAPIContract(t, http.MethodPost, endpoint, recorder)
		var response struct {
			Code int                            `json:"code"`
			Data apicontract.CreateSnapshotData `json:"data"`
		}
		if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil || response.Code != 0 {
			t.Fatalf("snapshot response: %s %v", recorder.Body.String(), err)
		}
		return response.Data
	}
	write("before")
	before := create(`{"memo":"before"}`)
	if !before.Created {
		t.Fatal("initial snapshot not created")
	}
	write("AFTER!")
	fast := create(`{"memo":"fast","fullCheck":false}`)
	if fast.Created || fast.ID != before.ID {
		t.Fatal("fast check did not reuse observations")
	}
	full := create(`{"memo":"full","fullCheck":true}`)
	if !full.Created || full.ID == before.ID {
		t.Fatal("HTTP full check skipped changed content")
	}
	stable := create(`{"fullCheck":true}`)
	if stable.Created || stable.ID != full.ID {
		t.Fatal("unchanged full check created a snapshot")
	}
	var upload bytes.Buffer
	writer := multipart.NewWriter(&upload)
	for _, field := range [][2]string{{"path", "data/probe.txt"}, {"isDir", "false"}, {"modTime", strconv.FormatInt(stamp.UnixMilli(), 10)}} {
		if err := writer.WriteField(field[0], field[1]); err != nil {
			t.Fatal(err)
		}
	}
	part, err := writer.CreateFormFile("file", "probe.txt")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = part.Write([]byte("LATER!")); err != nil {
		t.Fatal(err)
	}
	if err = writer.Close(); err != nil {
		t.Fatal(err)
	}
	engine.POST("/api/file/putFile", putFile)
	request := httptest.NewRequest(http.MethodPost, "/api/file/putFile", &upload)
	request.Header.Set("Content-Type", writer.FormDataContentType())
	recorder := httptest.NewRecorder()
	engine.ServeHTTP(recorder, request)
	requireAPIContract(t, http.MethodPost, "/api/file/putFile", recorder)
	var response struct {
		Code int `json:"code"`
	}
	if err = json.Unmarshal(recorder.Body.Bytes(), &response); err != nil || response.Code != 0 {
		t.Fatalf("putFile response: %s %v", recorder.Body.String(), err)
	}
	if info, statErr := os.Stat(file); statErr != nil || info.Size() != 6 || !info.ModTime().Equal(stamp) {
		t.Fatalf("putFile did not preserve file metadata: %v %v", info, statErr)
	}
	uploaded := create(`{"memo":"after putFile","fullCheck":false}`)
	if !uploaded.Created || uploaded.ID == full.ID {
		t.Fatal("normal HTTP snapshot skipped a known same-attribute upload")
	}
	repo, err := dejavu.NewRepo(util.DataDir, util.RepoDir, util.HistoryDir, util.TempDir, "snapshot-test", "test", "test", model.Conf.Repo.Load().Key, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	for _, version := range []struct{ id, content string }{{before.ID, "before"}, {full.ID, "AFTER!"}, {uploaded.ID, "LATER!"}} {
		index, err := repo.GetIndex(version.id)
		if err != nil {
			t.Fatal(err)
		}
		files, err := repo.GetFiles(index)
		if err != nil {
			t.Fatalf("snapshot file list: %v", err)
		}
		found := false
		for _, file := range files {
			if file.Path != "/probe.txt" {
				continue
			}
			found = true
			content, err := repo.OpenFile(file)
			if err != nil || string(content) != version.content {
				t.Fatalf("snapshot content %q: %v", content, err)
			}
		}
		if !found {
			t.Fatal("probe file absent from snapshot")
		}
	}
}

func TestSnapshotAPIErrors(t *testing.T) {
	original := model.Conf
	t.Cleanup(func() { model.Conf = original })
	model.Conf = model.NewAppConf()
	model.Conf.Repo.Store(conf.NewRepo())
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	engine.POST("/api/repo/createSnapshot", createSnapshot)
	engine.POST("/api/repo/checkSnapshot", checkSnapshot)
	engine.POST("/api/repo/setSnapshotMemo", setSnapshotMemo)
	for _, test := range []struct{ path, body string }{
		{"createSnapshot", `{}`},
		{"createSnapshot", `{"memo":""}`},
		{"createSnapshot", `{"memo":false}`},
		{"createSnapshot", `{"memo":"check","fullCheck":true}`},
		{"createSnapshot", `{"fullCheck":"true"}`},
		{"checkSnapshot", ``},
		{"setSnapshotMemo", `{"id":"invalid","memo":"note"}`},
		{"setSnapshotMemo", `{"id":"invalid"}`},
	} {
		path := "/api/repo/" + test.path
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, path, strings.NewReader(test.body)))
		requireAPIContract(t, http.MethodPost, path, recorder)
		var response struct {
			Code int `json:"code"`
		}
		if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil || response.Code != -1 {
			t.Fatalf("invalid request or uninitialized repository accepted: %s %s", path, recorder.Body.String())
		}
	}
}
