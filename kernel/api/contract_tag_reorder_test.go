// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"context"
	"encoding/json"
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

	"github.com/88250/lute/ast"
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
	languageData, err := os.ReadFile("../../app/appearance/langs/en.json")
	if err != nil {
		t.Fatal(err)
	}
	var language struct {
		Time map[string]any `json:"_time"`
	}
	if err = json.Unmarshal(languageData, &language); err != nil {
		t.Fatal(err)
	}
	util.TimeLangs[model.Conf.Lang] = language.Time
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

	labels = append(labels, "root519/recent")
	if err = model.SetBlockAttrs(tree.ID, map[string]string{"tags": strings.Join(labels, ",")}); err != nil {
		t.Fatal(err)
	}
	if recent := read(util.SortModeTagCreatedDESC, true); recent[0].Label != "root519" || recent[0].Children[0].Label != "root519/recent" {
		t.Fatal("recent sorting did not promote the newly tagged branch")
	}
	const attrPath = "/api/attr/getBlockAttrs"
	response := callAttributeViewContextFilterAPI(t, attrPath, map[string]any{"id": tree.ID}, getBlockAttrs)
	requireAPIContract(t, http.MethodPost, attrPath, response)
	var attrs struct {
		Code int
		Data map[string]string
	}
	decodeAttributeViewContextFilterAPIResponse(t, response, &attrs)
	if attrs.Code != 0 || !strings.HasPrefix(attrs.Data[treenode.TagCreatedAttr], `{"root519/recent":`) {
		t.Fatalf("getBlockAttrs did not expose the new association: %s", response.Body.String())
	}
}

func TestAPIContractTagPublishOrdering(t *testing.T) {
	const helper = "SIYUAN_TEST_TAG_PUBLISH_ORDERING"
	if os.Getenv(helper) == "" {
		ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
		defer cancel()
		command := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestAPIContractTagPublishOrdering$", "-test.v")
		command.Env = append(os.Environ(), helper+"=1")
		if output, err := command.CombinedOutput(); err != nil {
			t.Fatalf("published tag test subprocess failed: %v\n%s", err, output)
		}
		return
	}

	setupAttributeViewContextFilterAPITest(t)
	util.TempDir, util.ConfDir, util.QueueDir = t.TempDir(), t.TempDir(), t.TempDir()
	dbDir := t.TempDir()
	util.DBPath = filepath.Join(dbDir, "siyuan.db")
	util.HistoryDBPath = filepath.Join(dbDir, "history.db")
	util.AssetContentDBPath = filepath.Join(dbDir, "asset_content.db")
	sql.InitDatabase(true)
	sql.InitHistoryDatabase(true)
	sql.InitAssetContentDatabase(true)
	t.Cleanup(sql.CloseDatabase)
	model.Conf.FileTree.Load().MaxListCount = 1

	const boxID = "20261123000000-boxptag"
	box := &model.Box{ID: boxID}
	if err := box.SaveConf(conf.NewBoxConf()); err != nil {
		t.Fatal(err)
	}
	addDoc := func(dir, tags string) string {
		t.Helper()
		id := ast.NewNodeID()
		tree := treenode.NewTree(boxID, dir+"/"+id+".sy", "/"+id, id)
		tree.Root.SetIALAttr("tags", tags)
		if _, err := filesys.WriteTree(tree); err != nil {
			t.Fatal(err)
		}
		treenode.UpsertBlockTree(tree)
		sql.IndexTreeQueue(tree)
		return id
	}
	addDoc("", "alpha,beta,gamma")
	addDoc("", "alpha,beta")
	addDoc("", "alpha")
	protected := addDoc("", "gamma,locked-only")
	for range 3 {
		addDoc("/"+protected, "gamma")
	}
	sql.FlushQueue()

	const password = "fixture-password"
	if err := model.SetPublishAccess(model.PublishAccess{{ID: protected, Visible: true, Password: password}}); err != nil {
		t.Fatal(err)
	}
	type tagCount struct {
		label string
		count int
	}
	for _, test := range []struct {
		name     string
		role     model.Role
		sort     int
		full     bool
		unlocked bool
		want     []tagCount
	}{
		{"reader descending", model.RoleReader, util.SortModeRefCountDESC, true, false, []tagCount{{"alpha", 3}, {"beta", 2}, {"gamma", 1}}},
		{"visitor ascending", model.RoleVisitor, util.SortModeRefCountASC, true, false, []tagCount{{"gamma", 1}, {"beta", 2}, {"alpha", 3}}},
		{"reader limited", model.RoleReader, util.SortModeRefCountDESC, false, false, []tagCount{{"alpha", 3}, {"beta", 2}}},
		{"reader unlocked", model.RoleReader, util.SortModeRefCountDESC, true, true, []tagCount{{"gamma", 5}, {"alpha", 3}, {"beta", 2}, {"locked-only", 1}}},
		{"editor workspace", model.RoleEditor, util.SortModeRefCountDESC, true, false, []tagCount{{"gamma", 5}, {"alpha", 3}, {"beta", 2}, {"locked-only", 1}}},
	} {
		t.Run(test.name, func(t *testing.T) {
			const route = "/api/tag/getTag"
			body := fmt.Sprintf(`{"sort":%d,"ignoreMaxListHint":%t}`, test.sort, test.full)
			recorder := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(recorder)
			c.Request = httptest.NewRequest(http.MethodPost, route, strings.NewReader(body))
			c.Request.Header.Set("Content-Type", "application/json")
			c.Set(model.RoleContextKey, test.role)
			if test.unlocked {
				c.Request.AddCookie(&http.Cookie{
					Name: "publish-auth-" + protected, Value: model.PublishAuthCookieValue(protected, password),
				})
			}
			getTag(c)
			requireAPIContract(t, http.MethodPost, route, recorder)
			var response struct {
				Code int
				Data []*apicontract.TagData
			}
			decodeAttributeViewContextFilterAPIResponse(t, recorder, &response)
			got := make([]tagCount, 0, len(response.Data))
			for _, tag := range response.Data {
				got = append(got, tagCount{tag.Label, tag.Count})
			}
			if response.Code != 0 || !slices.Equal(got, test.want) {
				t.Fatalf("code %d: tags %v, want %v", response.Code, got, test.want)
			}
		})
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
