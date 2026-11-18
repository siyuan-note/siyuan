// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAPIContractTagReorderAndFullTree(t *testing.T) {
	if os.Getenv("SIYUAN_TEST_TAG_REORDER_CONTRACT") == "" {
		ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
		defer cancel()
		command := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestAPIContractTagReorderAndFullTree$", "-test.v")
		command.Env = append(os.Environ(), "SIYUAN_TEST_TAG_REORDER_CONTRACT=1")
		if output, err := command.CombinedOutput(); err != nil {
			t.Fatalf("tag reorder API subprocess failed: %v\n%s", err, output)
		}
		return
	}

	fixture := setupAttributeViewContextFilterAPITest(t)
	util.TempDir, util.ConfDir, util.HistoryDir, util.QueueDir = t.TempDir(), t.TempDir(), t.TempDir(), t.TempDir()
	fileTree := conf.NewFileTree()
	fileTree.MaxListCount = 10
	model.Conf.FileTree.Store(fileTree)
	tree, err := model.LoadTreeByBlockID(fixture.paragraphID)
	if err != nil {
		t.Fatal(err)
	}
	dbDir := t.TempDir()
	util.DBPath = filepath.Join(dbDir, "siyuan.db")
	util.HistoryDBPath = filepath.Join(dbDir, "history.db")
	util.AssetContentDBPath = filepath.Join(dbDir, "asset_content.db")
	sql.InitDatabase(true)
	sql.InitHistoryDatabase(true)
	sql.InitAssetContentDatabase(true)
	defer func() { sql.FlushQueue(); sql.CloseDatabase() }()
	labels := []string{"archive", "project/1/child", "project/2"}
	for i := range 520 {
		labels = append(labels, fmt.Sprintf("root%03d", i))
	}
	tree.Root.SetIALAttr("tags", strings.Join(labels, ","))
	if _, err = filesys.WriteTree(tree); err != nil {
		t.Fatal(err)
	}
	treenode.UpsertBlockTree(tree)
	sql.UpsertTreeQueue(tree)
	sql.FlushQueue()

	const readPath = "/api/tag/getTag"
	read := func(mode int, full bool) []*apicontract.TagData {
		t.Helper()
		response := callAttributeViewContextFilterAPI(t, readPath, map[string]any{"sort": mode, "ignoreMaxListHint": full}, getTag)
		requireAPIContract(t, http.MethodPost, readPath, response)
		var result struct {
			Code int
			Data []*apicontract.TagData
		}
		decodeAttributeViewContextFilterAPIResponse(t, response, &result)
		if result.Code != 0 {
			t.Fatal(response.Body.String())
		}
		return result.Data
	}
	full := read(util.SortModeCustom, true)
	if len(full) != 522 || full[len(full)-1].Label != "root519" {
		t.Fatalf("full data size or tail changed: %d", len(full))
	}
	if limited := read(util.SortModeCustom, false); len(limited) >= len(full) {
		t.Fatal("legacy read limit no longer applies")
	}

	const path = "/api/tag/reorderTag"
	for _, test := range []struct {
		label, target string
		want          int
	}{
		{"project", "archive", 0},
		{"project/2", "project/1", 0},
		{"root519", "project/1", -1},
		{"project/missing", "project/1", -1},
	} {
		response := callAttributeViewContextFilterAPI(t, path, map[string]any{
			"label": test.label, "target": test.target, "position": "before",
		}, reorderTag)
		requireAPIContract(t, http.MethodPost, path, response)
		var result struct{ Code int }
		decodeAttributeViewContextFilterAPIResponse(t, response, &result)
		if result.Code != test.want {
			t.Fatalf("move %q: %s", test.label, response.Body.String())
		}
	}

	custom := read(util.SortModeCustom, true)
	project := custom[0]
	children := []string{project.Children[0].Label, project.Children[1].Label}
	if project.Label != "project" || !slices.Equal(children, []string{"project/2", "project/1"}) ||
		project.Children[1].Count != 0 {
		t.Fatalf("saved hierarchy lost the sibling order: %s, %v", project.Label, children)
	}
	if automatic := read(util.SortModeAlphanumASC, true); automatic[0].Label != "archive" || automatic[1].Children[0].Label != "project/1" {
		t.Fatal("automatic sort changed")
	}
	if again := read(util.SortModeCustom, true); again[0].Label != "project" || again[0].Children[0].Label != "project/2" {
		t.Fatal("returning to manual sort lost the saved order")
	}
}

func TestAPIContractTagReorderRequiresWritableAdmin(t *testing.T) {
	route := contractRouteHandlers(apicontract.ReorderTag, reorderTag)
	if len(route) != 4 {
		t.Fatal("tag reorder route is missing authorization middleware")
	}
	path := apicontract.ReorderTag.Definition().Path
	engine := gin.New()
	engine.Use(func(c *gin.Context) { c.Set(model.RoleContextKey, model.RoleReader) })
	engine.POST(path, route[1:]...)
	response := httptest.NewRecorder()
	engine.ServeHTTP(response, httptest.NewRequest(http.MethodPost, path,
		strings.NewReader("{\"label\":\"a\",\"target\":\"b\",\"position\":\"before\"}")))
	if response.Code != http.StatusForbidden {
		t.Fatalf("reader accessed tag reorder: status %d", response.Code)
	}
}
