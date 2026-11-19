// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// TestGetRecentDocsHidesActivityFromReader 验证发布读者拿不到工作区文档的浏览、打开和关闭时间
// https://github.com/siyuan-note/siyuan/security/advisories/GHSA-rxmp-mffv-3g79
func TestGetRecentDocsHidesActivityFromReader(t *testing.T) {
	gin.SetMode(gin.TestMode)

	const (
		boxID    = "20261117004000-recentb"
		publicID = "20261117004001-publicd"
		hiddenID = "20261117004002-hiddend"
	)
	oldDataDir, oldBlockTreeDBPath, oldConf := util.DataDir, util.BlockTreeDBPath, model.Conf
	util.DataDir = t.TempDir()
	util.BlockTreeDBPath = filepath.Join(util.DataDir, "blocktree.db")
	model.Conf = model.NewAppConf()
	model.Conf.Lang = "en"
	model.Conf.FileTree.Store(conf.NewFileTree())
	model.Conf.Sync.Store(conf.NewSync())
	model.Conf.System.Store(conf.NewSystem())
	model.Conf.Editor.Store(conf.NewEditor())
	model.Conf.Search.Store(conf.NewSearch())
	model.Conf.Export.Store(conf.NewExport())
	treenode.InitBlockTree(true)
	t.Cleanup(func() {
		treenode.CloseDatabase()
		util.DataDir, util.BlockTreeDBPath, model.Conf = oldDataDir, oldBlockTreeDBPath, oldConf
	})

	for _, id := range []string{publicID, hiddenID} {
		tree := treenode.NewTree(boxID, "/"+id+".sy", "/"+id, id)
		if _, err := filesys.WriteTree(tree); err != nil {
			t.Fatalf("write document %s: %v", id, err)
		}
		treenode.UpsertBlockTree(tree)
	}
	storageDir := filepath.Join(util.DataDir, "storage")
	if err := os.MkdirAll(storageDir, 0o700); err != nil {
		t.Fatal(err)
	}
	records := `[{"rootID":"` + publicID + `","viewedAt":1710000001,"openAt":1710000002,"closedAt":1710000003},` +
		`{"rootID":"` + hiddenID + `","viewedAt":1710000011,"openAt":1710000012,"closedAt":1710000013}]`
	if err := os.WriteFile(filepath.Join(storageDir, "recent-doc.json"), []byte(records), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := model.SetPublishAccess(model.PublishAccess{{ID: hiddenID, Visible: false}}); err != nil {
		t.Fatal(err)
	}

	call := func(role model.Role) []map[string]any {
		t.Helper()
		engine := gin.New()
		engine.Use(func(c *gin.Context) { c.Set(model.RoleContextKey, role); c.Next() })
		engine.POST("/api/storage/getRecentDocs", getRecentDocs)
		recorder := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/api/storage/getRecentDocs", strings.NewReader(`{"sortBy":"viewedAt"}`))
		req.Header.Set("Content-Type", "application/json")
		engine.ServeHTTP(recorder, req)
		var response struct {
			Code int              `json:"code"`
			Data []map[string]any `json:"data"`
		}
		if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
			t.Fatalf("invalid recent docs response %q: %v", recorder.Body.String(), err)
		}
		if response.Code != 0 {
			t.Fatalf("recent docs request failed: %s", recorder.Body.String())
		}
		return response.Data
	}

	admin := call(model.RoleAdministrator)
	if len(admin) != 2 {
		t.Fatalf("administrator recent docs = %v, want two records", admin)
	}
	for _, doc := range admin {
		for _, key := range []string{"viewedAt", "openAt", "closedAt"} {
			if _, ok := doc[key]; !ok {
				t.Fatalf("administrator recent doc lost %s: %v", key, doc)
			}
		}
	}

	reader := call(model.RoleReader)
	if len(reader) != 1 || reader[0]["rootID"] != publicID {
		t.Fatalf("reader recent docs = %v, want the publish-visible document only", reader)
	}
	for _, key := range []string{"viewedAt", "openAt", "closedAt"} {
		if _, ok := reader[0][key]; ok {
			t.Fatalf("reader recent doc exposed workspace activity %s: %v", key, reader[0])
		}
	}
}
