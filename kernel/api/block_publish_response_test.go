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
	"strings"
	"testing"
	"time"

	"github.com/88250/lute/ast"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// TestBlockPublishDeniedMissingResponses 校验只读角色下发布拒绝与不存在返回相同的空结果。
// 两个响应只有调用方已知的请求 ID 不同，不能通过状态、消息或键位区分块是否存在。
func TestBlockPublishDeniedMissingResponses(t *testing.T) {
	const helper = "SIYUAN_TEST_BLOCK_PUBLISH_DENIED_MISSING"
	if os.Getenv(helper) != "1" {
		ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
		defer cancel()
		command := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestBlockPublishDeniedMissingResponses$", "-test.v")
		command.Env = append(os.Environ(), helper+"=1")
		if output, err := command.CombinedOutput(); err != nil {
			t.Fatalf("publish response subprocess failed: %v\n%s", err, output)
		}
		return
	}

	root := t.TempDir()
	util.WorkspaceDir = root
	util.DataDir = filepath.Join(root, "data")
	util.TempDir = root
	util.ConfDir = root
	util.QueueDir = filepath.Join(root, "queue")
	util.DBPath = filepath.Join(root, "siyuan.db")
	util.HistoryDBPath = filepath.Join(root, "history.db")
	util.AssetContentDBPath = filepath.Join(root, "asset_content.db")
	util.BlockTreeDBPath = filepath.Join(root, "blocktree.db")
	util.ReadOnly = false
	if err := os.MkdirAll(util.DataDir, 0755); err != nil {
		t.Fatal(err)
	}

	model.Conf = model.NewAppConf()
	model.Conf.Lang = "en"
	model.Conf.FileTree.Store(conf.NewFileTree())
	model.Conf.Sync.Store(conf.NewSync())
	model.Conf.Search.Store(conf.NewSearch())
	model.Conf.Editor.Store(conf.NewEditor())
	model.Conf.Export.Store(conf.NewExport())
	model.Conf.NotebookCrypto = conf.NewNotebookCrypto()

	sql.InitDatabase(true)
	sql.InitHistoryDatabase(true)
	sql.InitAssetContentDatabase(true)
	treenode.InitBlockTree(true)
	defer treenode.CloseDatabase()
	defer sql.CloseDatabase()

	const (
		boxID        = "20261117000000-boxorac"
		publicDocID  = "20261117000001-pubdoc1"
		publicParaID = "20261117000002-pubpara"
		deniedDocID  = "20261117000003-denied1"
		deniedParaID = "20261117000004-denpar1"
		missingID    = "20261117000005-missing"
	)

	box := &model.Box{ID: boxID}
	boxConf := conf.NewBoxConf()
	boxConf.Name = "Publish response oracle"
	if err := box.SaveConf(boxConf); err != nil {
		t.Fatalf("save box conf: %v", err)
	}

	writeTree := func(docID, paraID, text string) {
		tree := treenode.NewTree(boxID, "/"+docID+".sy", "/"+docID, docID)
		tree.Root.FirstChild.Unlink()
		paragraph := treenode.NewParagraph(paraID)
		paragraph.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte(text)})
		tree.Root.AppendChild(paragraph)
		if _, err := filesys.WriteTree(tree); err != nil {
			t.Fatalf("write tree %s: %v", docID, err)
		}
		treenode.IndexBlockTree(tree)
		sql.IndexTreeQueue(tree)
	}
	writeTree(publicDocID, publicParaID, "public text")
	writeTree(deniedDocID, deniedParaID, "denied text")
	sql.FlushQueue()

	if err := model.SetPublishAccess(model.PublishAccess{
		{ID: publicDocID, Visible: true},
		{ID: deniedDocID, Visible: true, Disable: true},
	}); err != nil {
		t.Fatalf("set publish access: %v", err)
	}

	post := func(role model.Role, path, body string, handler gin.HandlerFunc) map[string]any {
		t.Helper()
		gin.SetMode(gin.TestMode)
		engine := gin.New()
		engine.Use(func(c *gin.Context) {
			c.Set(model.RoleContextKey, role)
			c.Next()
		})
		engine.POST(path, handler)
		recorder := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
		request.Header.Set("Content-Type", "application/json")
		engine.ServeHTTP(recorder, request)
		var response map[string]any
		if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
			t.Fatalf("%s: invalid response %q: %v", path, recorder.Body.String(), err)
		}
		return response
	}

	singleBody := func(id string) string { return fmt.Sprintf(`{"id":%q}`, id) }
	batchBody := func(id string) string { return fmt.Sprintf(`{"ids":[%q]}`, id) }
	kramdownBody := func(id string) string { return fmt.Sprintf(`{"id":%q,"mode":"md"}`, id) }
	kramdownsBody := func(id string) string { return fmt.Sprintf(`{"ids":[%q],"mode":"md"}`, id) }

	type endpoint struct {
		name        string
		path        string
		handler     gin.HandlerFunc
		disabled    string
		missing     string
		visible     string
		visibleData func(map[string]any) bool
	}
	nonEmpty := func(key string) func(map[string]any) bool {
		return func(response map[string]any) bool {
			data, ok := response["data"].(map[string]any)
			return ok && data[key] != nil && data[key] != ""
		}
	}
	nonEmptyMap := func(response map[string]any) bool {
		data, ok := response["data"].(map[string]any)
		return ok && len(data) > 0
	}

	endpoints := []endpoint{
		{name: "getBlockDOM", path: "/api/block/getBlockDOM", handler: getBlockDOM,
			disabled: singleBody(deniedParaID), missing: singleBody(missingID), visible: singleBody(publicParaID), visibleData: nonEmpty("dom")},
		{name: "getBlockDOMWithEmbed", path: "/api/block/getBlockDOMWithEmbed", handler: getBlockDOMWithEmbed,
			disabled: singleBody(deniedParaID), missing: singleBody(missingID), visible: singleBody(publicParaID), visibleData: nonEmpty("dom")},
		{name: "getBlockDOMs", path: "/api/block/getBlockDOMs", handler: getBlockDOMs,
			disabled: batchBody(deniedParaID), missing: batchBody(missingID), visible: batchBody(publicParaID), visibleData: nonEmptyMap},
		{name: "getBlockDOMsWithEmbed", path: "/api/block/getBlockDOMsWithEmbed", handler: getBlockDOMsWithEmbed,
			disabled: batchBody(deniedParaID), missing: batchBody(missingID), visible: batchBody(publicParaID), visibleData: nonEmptyMap},
		{name: "getBlockKramdown", path: "/api/block/getBlockKramdown", handler: getBlockKramdown,
			disabled: kramdownBody(deniedParaID), missing: kramdownBody(missingID), visible: kramdownBody(publicParaID), visibleData: nonEmpty("kramdown")},
		{name: "getBlockKramdowns", path: "/api/block/getBlockKramdowns", handler: getBlockKramdowns,
			disabled: kramdownsBody(deniedParaID), missing: kramdownsBody(missingID), visible: kramdownsBody(publicParaID), visibleData: nonEmptyMap},
		{name: "getBlockTreeInfos", path: "/api/block/getBlockTreeInfos", handler: getBlockTreeInfos,
			disabled: batchBody(deniedParaID), missing: batchBody(missingID), visible: batchBody(publicParaID), visibleData: nonEmptyMap},
		{name: "getBlocksIndexes", path: "/api/block/getBlocksIndexes", handler: getBlocksIndexes,
			disabled: batchBody(deniedParaID), missing: batchBody(missingID), visible: batchBody(publicParaID), visibleData: nonEmptyMap},
		{name: "getBlockSiblingID", path: "/api/block/getBlockSiblingID", handler: getBlockSiblingID,
			disabled: singleBody(deniedParaID), missing: singleBody(missingID), visible: singleBody(publicParaID), visibleData: nonEmpty("parent")},
		{name: "getBlockRelevantIDs", path: "/api/block/getBlockRelevantIDs", handler: getBlockRelevantIDs,
			disabled: singleBody(deniedParaID), missing: singleBody(missingID), visible: singleBody(publicParaID), visibleData: nonEmpty("parentID")},
		{name: "getTreeStat", path: "/api/block/getTreeStat", handler: getTreeStat,
			disabled: singleBody(deniedParaID), missing: singleBody(missingID), visible: singleBody(publicParaID), visibleData: func(response map[string]any) bool {
				data, ok := response["data"].(map[string]any)
				return ok && data["stat"] != nil
			}},
		{name: "getUnfoldedParentID", path: "/api/block/getUnfoldedParentID", handler: getUnfoldedParentID,
			disabled: singleBody(deniedParaID), missing: singleBody(missingID), visible: singleBody(publicParaID), visibleData: func(response map[string]any) bool {
				return response["code"] == float64(0)
			}},
	}

	normalize := func(response map[string]any, requestID string) string {
		t.Helper()
		encoded, err := json.Marshal(response)
		if err != nil {
			t.Fatalf("marshal response: %v", err)
		}
		return strings.ReplaceAll(string(encoded), requestID, "<requested-id>")
	}

	for _, test := range endpoints {
		t.Run(test.name, func(t *testing.T) {
			denied := post(model.RoleReader, test.path, test.disabled, test.handler)
			missing := post(model.RoleReader, test.path, test.missing, test.handler)
			if got, want := normalize(missing, missingID), normalize(denied, deniedParaID); got != want {
				t.Fatalf("denied and missing responses differ:\n denied: %s\n missing: %s", want, got)
			}

			visible := post(model.RoleReader, test.path, test.visible, test.handler)
			if visible["code"] != float64(0) {
				t.Fatalf("visible control failed: %v", visible)
			}
			if test.visibleData != nil && !test.visibleData(visible) {
				t.Fatalf("visible control returned no data: %v", visible)
			}
		})
	}

	adminMissing := post(model.RoleAdministrator, "/api/block/getBlockDOM", singleBody(missingID), getBlockDOM)
	if adminMissing["code"] != float64(-1) {
		t.Fatalf("administrator missing block must keep the failure response: %v", adminMissing)
	}
}
