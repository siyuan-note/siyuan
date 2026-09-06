// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/dejavu"
	"github.com/siyuan-note/dejavu/cloud"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestDeferredAssetAPIAuthorizationAndMetadata(t *testing.T) {
	gin.SetMode(gin.TestMode)
	originalConf := model.Conf
	originalWorkspace, originalData, originalRepo := util.WorkspaceDir, util.DataDir, util.RepoDir
	originalHistory, originalTemp, originalConfDir := util.HistoryDir, util.TempDir, util.ConfDir
	originalStatusBar := util.StatusBarCfg
	t.Cleanup(func() {
		model.Conf = originalConf
		util.WorkspaceDir, util.DataDir, util.RepoDir = originalWorkspace, originalData, originalRepo
		util.HistoryDir, util.TempDir, util.ConfDir = originalHistory, originalTemp, originalConfDir
		util.StatusBarCfg = originalStatusBar
	})
	base := t.TempDir()
	remote := filepath.Join(base, "cloud")
	key := []byte("0123456789abcdef0123456789abcdef")
	model.Conf = model.NewAppConf()
	model.Conf.Sync, model.Conf.Repo, model.Conf.System = conf.NewSync(), conf.NewRepo(), conf.NewSystem()
	model.Conf.Search, model.Conf.FileTree = conf.NewSearch(), conf.NewFileTree()
	model.Conf.Sync.Provider, model.Conf.Sync.CloudName, model.Conf.Sync.Enabled = conf.ProviderLocal, "main", true
	model.Conf.Sync.Local = &conf.Local{Endpoint: remote}
	model.Conf.Sync.AssetDownloadMode, model.Conf.Repo.Key = 1, key
	model.Conf.SetUser(&conf.User{UserId: "asset-api-test", UserSiYuanOneTimePayStatus: 1})
	util.StatusBarCfg = &util.StatusBar{MsgDataSyncDisabled: true}
	util.WorkspaceDir = filepath.Join(base, "partial")
	util.DataDir, util.RepoDir = filepath.Join(util.WorkspaceDir, "data"), filepath.Join(util.WorkspaceDir, "repo")
	util.HistoryDir, util.TempDir = filepath.Join(util.WorkspaceDir, "history"), filepath.Join(util.WorkspaceDir, "temp")
	util.ConfDir = filepath.Join(util.WorkspaceDir, "conf")
	// 测试仓库使用内核的本地存储来源格式，以便验证获准请求能够实际补齐资源。
	identity, err := json.Marshal([]string{fmt.Sprint(conf.ProviderLocal), "main", fmt.Sprintf("%x", sha256.Sum256(key)), filepath.Clean(remote)})
	if err != nil {
		t.Fatal(err)
	}
	scope := fmt.Sprintf("%x", sha256.Sum256(identity))
	makeRepo := func(name string, onDemand bool) *dejavu.Repo {
		t.Helper()
		dir := filepath.Join(base, name)
		repoPath := filepath.Join(dir, "repo")
		backend := cloud.NewLocal(&cloud.BaseCloud{Conf: &cloud.Conf{Dir: "main", RepoPath: repoPath,
			AvailableSize: 1024 * 1024 * 1024, Local: &cloud.ConfLocal{Endpoint: remote}}})
		repo, createErr := dejavu.NewRepo(filepath.Join(dir, "data"), repoPath, filepath.Join(dir, "history"),
			filepath.Join(dir, "temp"), name, name, "windows", key, nil, backend)
		if createErr != nil {
			t.Fatal(createErr)
		}
		if createErr = os.MkdirAll(filepath.Join(dir, "data"), 0755); createErr != nil {
			t.Fatal(createErr)
		}
		if createErr = os.WriteFile(filepath.Join(dir, "data", "seed.txt"), []byte("seed"), 0644); createErr != nil {
			t.Fatal(createErr)
		}
		if _, createErr = repo.Index("seed", true, nil); createErr != nil {
			t.Fatal(createErr)
		}
		if createErr = repo.ConfigureAssetDownloads(onDemand, filepath.Join(dir, "conf", "asset-downloads.json"), scope); createErr != nil {
			t.Fatal(createErr)
		}
		return repo
	}
	full := makeRepo("full", false)
	const boxID = "20260905123456-abcdefg"
	boxConf := conf.NewBoxConf()
	boxConf.Encrypted = true
	boxConfData, err := json.Marshal(boxConf)
	if err != nil {
		t.Fatal(err)
	}
	files := map[string][]byte{
		"assets/plain.bin":            []byte("asset bytes downloaded only after authorization"),
		boxID + "/assets/private.bin": []byte("locked ciphertext fixture"),
		boxID + "/.siyuan/conf.json":  boxConfData,
	}
	for name, data := range files {
		absPath := filepath.Join(base, "full", "data", filepath.FromSlash(name))
		if err = os.MkdirAll(filepath.Dir(absPath), 0755); err != nil {
			t.Fatal(err)
		}
		if err = os.WriteFile(absPath, data, 0644); err != nil {
			t.Fatal(err)
		}
	}
	if _, err = full.Index("assets", true, nil); err != nil {
		t.Fatal(err)
	}
	if _, _, err = full.Sync(nil); err != nil {
		t.Fatal(err)
	}
	partial := makeRepo("partial", true)
	if _, _, err = partial.Sync(nil); err != nil {
		t.Fatal(err)
	}
	deferred, err := model.DeferredSyncAssets()
	if err != nil || len(deferred) != 2 {
		t.Fatalf("expected two deferred assets: %+v, %v", deferred, err)
	}
	statePath := filepath.Join(util.ConfDir, "asset-downloads.json")
	stateBefore, err := os.ReadFile(statePath)
	if err != nil {
		t.Fatal(err)
	}
	assertNoDownloads := func() {
		t.Helper()
		stateAfter, readErr := os.ReadFile(statePath)
		if readErr != nil || !bytes.Equal(stateBefore, stateAfter) {
			t.Fatalf("read-only or denied request changed download state: %v", readErr)
		}
		for _, file := range deferred {
			absPath := filepath.Join(util.DataDir, filepath.FromSlash(file.Path))
			if _, statErr := os.Stat(absPath); !os.IsNotExist(statErr) {
				t.Fatalf("read-only or denied request materialized %q: %v", file.Path, statErr)
			}
			for _, chunkID := range file.Chunks {
				if _, statErr := os.Stat(filepath.Join(util.RepoDir, "objects", chunkID[:2], chunkID[2:])); !os.IsNotExist(statErr) {
					t.Fatalf("read-only or denied request downloaded chunk %q: %v", chunkID, statErr)
				}
			}
		}
	}
	assertNoDownloads()
	request := func(role model.Role, endpoint string, args any) *httptest.ResponseRecorder {
		t.Helper()
		engine := gin.New()
		engine.Use(func(c *gin.Context) {
			c.Set(model.RoleContextKey, role)
			c.Next()
		})
		ServeAPI(engine)
		body, marshalErr := json.Marshal(args)
		if marshalErr != nil {
			t.Fatal(marshalErr)
		}
		recorder := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, endpoint, bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		engine.ServeHTTP(recorder, req)
		return recorder
	}
	t.Run("metadata", func(t *testing.T) {
		recorder := request(model.RoleAdministrator, "/api/asset/statAsset", map[string]string{"path": "assets/plain.bin"})
		response := struct {
			Code int `json:"code"`
			Data struct {
				Size       int64 `json:"size"`
				Downloaded *bool `json:"downloaded"`
			} `json:"data"`
		}{}
		if err = json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
			t.Fatal(err)
		}
		if recorder.Code != http.StatusOK || response.Code != 0 || response.Data.Size != int64(len(files["assets/plain.bin"])) ||
			response.Data.Downloaded == nil || *response.Data.Downloaded {
			t.Fatalf("unexpected deferred metadata: %s", recorder.Body.String())
		}
		assertNoDownloads()
	})
	for _, endpoint := range []string{"/api/asset/statAsset", "/api/asset/resolveAssetPath", "/api/clipboard/writeFilePath", "/api/file/copyFile"} {
		t.Run("reader"+endpoint, func(t *testing.T) {
			recorder := request(model.RoleReader, endpoint, map[string]string{"path": "assets/plain.bin", "src": "data/assets/plain.bin", "dest": "temp/copied.bin"})
			if recorder.Code != http.StatusForbidden {
				t.Fatalf("reader unexpectedly authorized: %d %s", recorder.Code, recorder.Body.String())
			}
			assertNoDownloads()
		})
	}
	for _, test := range []struct {
		name string
		role model.Role
		path string
		code int
	}{
		{"unpublished", model.RoleReader, "data/assets/plain.bin", http.StatusForbidden},
		{"encrypted", model.RoleAdministrator, "data/" + boxID + "/assets/private.bin", -3},
	} {
		t.Run(test.name, func(t *testing.T) {
			recorder := request(test.role, "/api/file/getFile", map[string]string{"path": test.path})
			response := struct {
				Code int `json:"code"`
			}{}
			if err = json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
				t.Fatal(err)
			}
			if recorder.Code != http.StatusAccepted || response.Code != test.code {
				t.Fatalf("unexpected access denial: %d %s", recorder.Code, recorder.Body.String())
			}
			assertNoDownloads()
		})
	}
	t.Run("encrypted-descendant", func(t *testing.T) {
		recorder := request(model.RoleAdministrator, "/api/file/workspaceCopyFiles", map[string]any{
			"srcs": []string{"data"}, "destDir": "temp/export/copied",
		})
		response := struct {
			Code int `json:"code"`
		}{}
		if err = json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
			t.Fatal(err)
		}
		if response.Code == 0 {
			t.Fatalf("raw directory copy accepted an encrypted notebook descendant: %s", recorder.Body.String())
		}
		if _, statErr := os.Stat(filepath.Join(util.TempDir, "export", "copied")); !os.IsNotExist(statErr) {
			t.Fatalf("denied directory copy created output: %v", statErr)
		}
		assertNoDownloads()
	})
	t.Run("authorized", func(t *testing.T) {
		recorder := request(model.RoleAdministrator, "/api/file/getFile", map[string]string{"path": "data/assets/plain.bin"})
		if recorder.Code != http.StatusOK || !bytes.Equal(recorder.Body.Bytes(), files["assets/plain.bin"]) {
			t.Fatalf("authorized request failed to retrieve content: %d %s", recorder.Code, recorder.Body.String())
		}
		model.Conf.Sync.Enabled = false
		model.Conf.SetUser(nil)
		recorder = request(model.RoleAdministrator, "/api/file/getFile", map[string]string{"path": "data/assets/plain.bin"})
		if recorder.Code != http.StatusOK || !bytes.Equal(recorder.Body.Bytes(), files["assets/plain.bin"]) {
			t.Fatalf("cached asset unavailable offline: %d %s", recorder.Code, recorder.Body.String())
		}
	})
}
