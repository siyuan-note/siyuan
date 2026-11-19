// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// TestEncryptedNotebookLockStateNotExposedToReader 验证发布读者无法根据响应差异判断加密笔记本是否解锁
// https://github.com/siyuan-note/siyuan/security/advisories/GHSA-v79r-27qf-2pmg
func TestEncryptedNotebookLockStateNotExposedToReader(t *testing.T) {
	gin.SetMode(gin.TestMode)

	const (
		boxID   = "20261117003000-lockorc"
		blockID = "20261117003001-lockblk"
	)
	oldDataDir, oldBlockTreeDBPath, oldConf := util.DataDir, util.BlockTreeDBPath, model.Conf
	util.DataDir = t.TempDir()
	util.BlockTreeDBPath = filepath.Join(util.DataDir, "blocktree.db")
	model.Conf = model.NewAppConf()
	model.Conf.Lang = "en"
	model.Conf.NotebookCrypto = conf.NewNotebookCrypto()
	treenode.InitBlockTree(true)
	t.Cleanup(func() {
		treenode.CloseDatabase()
		util.DataDir, util.BlockTreeDBPath, model.Conf = oldDataDir, oldBlockTreeDBPath, oldConf
	})

	boxConf := conf.NewBoxConf()
	boxConf.Encrypted = true
	if err := (&model.Box{ID: boxID}).SaveConf(boxConf); err != nil {
		t.Fatalf("save encrypted notebook conf: %v", err)
	}
	if !model.IsEncryptedBox(boxID) || model.IsBoxUnlocked(boxID) {
		t.Fatal("fixture must be a locked encrypted notebook")
	}

	request := func(role model.Role, path string, handler gin.HandlerFunc, body string) map[string]any {
		t.Helper()
		engine := gin.New()
		engine.Use(func(c *gin.Context) { c.Set(model.RoleContextKey, role); c.Next() })
		engine.POST(path, handler)
		recorder := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		engine.ServeHTTP(recorder, req)
		var response map[string]any
		if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
			t.Fatalf("%s: invalid response %q: %v", path, recorder.Body.String(), err)
		}
		return response
	}

	endpoints := []struct {
		name    string
		path    string
		handler gin.HandlerFunc
	}{
		{name: "checkBlockFold", path: "/api/block/checkBlockFold", handler: checkBlockFold},
		{name: "checkBlockExist", path: "/api/block/checkBlockExist", handler: checkBlockExist},
		{name: "getUnfoldedParentID", path: "/api/block/getUnfoldedParentID", handler: getUnfoldedParentID},
	}
	body := `{"id":"` + blockID + `","notebook":"` + boxID + `"}`
	for _, endpoint := range endpoints {
		reader := request(model.RoleReader, endpoint.path, endpoint.handler, body)
		if code, _ := reader["code"].(float64); code != 0 {
			t.Fatalf("%s: reader learned the encrypted notebook lock state: %v", endpoint.name, reader)
		}
		admin := request(model.RoleAdministrator, endpoint.path, endpoint.handler, body)
		if code, _ := admin["code"].(float64); code != -1 {
			t.Fatalf("%s: administrator should still receive the locked denial: %v", endpoint.name, admin)
		}
	}
}
