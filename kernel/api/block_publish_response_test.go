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
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestContractBlockPublishResponses(t *testing.T) {
	const helper = "SIYUAN_TEST_BLOCK_PUBLISH_DENIED_MISSING"
	if os.Getenv(helper) != "1" {
		ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
		defer cancel()
		command := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestContractBlockPublishResponses$", "-test.v")
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
	searchConf := conf.NewSearch()
	searchConf.VirtualRefAnchor = true
	model.Conf.Search.Store(searchConf)
	editorConf := conf.NewEditor()
	editorConf.VirtualBlockRef = true
	model.Conf.Editor.Store(editorConf)
	model.Conf.Export.Store(conf.NewExport())
	model.Conf.NotebookCrypto = conf.NewNotebookCrypto()

	sql.InitDatabase(true)
	sql.InitHistoryDatabase(true)
	sql.InitAssetContentDatabase(true)
	treenode.InitBlockTree(true)
	defer treenode.CloseDatabase()
	defer sql.CloseDatabase()

	const (
		boxID         = "20261117000000-boxorac"
		publicDocID   = "20261117000001-pubdoc1"
		publicParaID  = "20261117000002-pubpara"
		deniedDocID   = "20261117000003-denied1"
		deniedParaID  = "20261117000004-denpar1"
		missingID     = "20261117000005-missing"
		protectedID   = "20261117000006-gatedoc"
		protectedP    = "20261117000007-gatepar"
		embedID       = "20261117000008-statemb"
		password      = "document password"
		publicAnchor  = "Visible Topic"
		privateAnchor = "Restricted Topic"
		publicName    = "Public name"
		publicAlias   = "Public alias"
	)

	box := &model.Box{ID: boxID}
	boxConf := conf.NewBoxConf()
	boxConf.Name = "Publish response oracle"
	if err := box.SaveConf(boxConf); err != nil {
		t.Fatalf("save box conf: %v", err)
	}

	writeTree := func(docID, paraID, text string, inlines ...*ast.Node) {
		tree := treenode.NewTree(boxID, "/"+docID+".sy", "/"+docID, docID)
		tree.Root.FirstChild.Unlink()
		paragraph := treenode.NewParagraph(paraID)
		paragraph.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte(text)})
		for _, inline := range inlines {
			paragraph.AppendChild(inline)
		}
		tree.Root.AppendChild(paragraph)
		if docID == publicDocID {
			paragraph.SetIALAttr("name", publicName)
			paragraph.SetIALAttr("alias", publicAlias)
			embed := &ast.Node{Type: ast.NodeBlockQueryEmbed, ID: embedID}
			embed.AppendChild(&ast.Node{Type: ast.NodeBlockQueryEmbedScript,
				Tokens: []byte(fmt.Sprintf("SELECT * FROM blocks WHERE id = '%s'", deniedParaID))})
			tree.Root.AppendChild(embed)
		}
		if _, err := filesys.WriteTree(tree); err != nil {
			t.Fatalf("write tree %s: %v", docID, err)
		}
		treenode.IndexBlockTree(tree)
		sql.IndexTreeQueue(tree)
	}
	ref := func(target, anchor string) *ast.Node {
		return &ast.Node{Type: ast.NodeTextMark, TextMarkType: "block-ref",
			TextMarkBlockRefID: target, TextMarkBlockRefSubtype: "s", TextMarkTextContent: anchor}
	}
	writeTree(publicDocID, publicParaID, publicAnchor+" and "+privateAnchor,
		ref(publicDocID, publicAnchor), ref(deniedDocID, "Unavailable Target"))
	writeTree(deniedDocID, deniedParaID, "denied text",
		ref(publicDocID, "Disabled Source"), ref(publicDocID, publicAnchor))
	writeTree(protectedID, protectedP, "protected text", ref(publicDocID, privateAnchor))
	sql.FlushQueue()

	if err := model.SetPublishAccess(model.PublishAccess{
		{ID: publicDocID, Visible: true},
		{ID: deniedDocID, Visible: true, Disable: true},
		{ID: protectedID, Visible: true, Password: password},
	}); err != nil {
		t.Fatalf("set publish access: %v", err)
	}

	postWithCookie := func(role model.Role, cookie *http.Cookie, path, body string, handlers ...gin.HandlerFunc) map[string]any {
		t.Helper()
		gin.SetMode(gin.TestMode)
		engine := gin.New()
		engine.Use(boxLeaseMiddleware)
		engine.Use(func(c *gin.Context) {
			c.Set(model.RoleContextKey, role)
			c.Next()
		})
		engine.POST(path, handlers...)
		recorder := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
		request.Header.Set("Content-Type", "application/json")
		if cookie != nil {
			request.AddCookie(cookie)
		}
		engine.ServeHTTP(recorder, request)
		var response map[string]any
		if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
			t.Fatalf("%s: invalid response %q: %v", path, recorder.Body.String(), err)
		}
		return response
	}
	post := func(role model.Role, path, body string, handler gin.HandlerFunc) map[string]any {
		return postWithCookie(role, nil, path, body, handler)
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

	t.Run("ContractTreeStatReaderBodyOnly", func(t *testing.T) {
		const path = "/api/block/getTreeStat"
		route := contractRouteHandlers(apicontract.GetTreeStat, getTreeStat)
		body := fmt.Sprintf(`{"id":%q,"includeEmbed":true}`, publicDocID)
		reader := postWithCookie(model.RoleReader, nil, path, body, route...)
		base := postWithCookie(model.RoleReader, nil, path, singleBody(publicDocID), route...)
		if normalize(reader, publicDocID) != normalize(base, publicDocID) {
			t.Fatalf("reader response includes embed statistics: %v", reader)
		}
		data := reader["data"].(map[string]any)
		if reader["code"] != float64(0) || data["stat"] == nil || data["containsEmbed"] != true {
			t.Fatalf("reader did not receive document statistics: %v", reader)
		}
		admin := postWithCookie(model.RoleAdministrator, nil, path, body, route...)
		adminData := admin["data"].(map[string]any)
		embedStat, ok := adminData["embedStat"].(map[string]any)
		if !ok || embedStat["resultCount"] != float64(1) || adminData["statWithEmbed"] == nil {
			t.Fatalf("administrator did not receive embed statistics: %v", admin)
		}
	})

	publishCookie := &http.Cookie{
		Name:  "publish-auth-" + protectedID,
		Value: model.PublishAuthCookieValue(protectedID, password),
	}
	t.Run("ContractRefTextReaderRequiresBothBlocks", func(t *testing.T) {
		const path = "/api/block/getBlockDefIDsByRefText"
		route := contractRouteHandlers(apicontract.GetBlockDefIDsByRefText, getBlockDefIDsByRefText)
		for _, test := range []struct {
			anchor string
			role   model.Role
			cookie *http.Cookie
			target string
		}{
			{anchor: "Missing topic", role: model.RoleReader},
			{anchor: privateAnchor, role: model.RoleReader},
			{anchor: "Disabled Source", role: model.RoleReader},
			{anchor: "Unavailable Target", role: model.RoleReader},
			{anchor: publicAnchor, role: model.RoleReader, target: publicDocID},
			{anchor: publicDocID, role: model.RoleReader, target: publicDocID},
			{anchor: publicName, role: model.RoleReader, target: publicParaID},
			{anchor: publicAlias, role: model.RoleReader, target: publicParaID},
			{anchor: privateAnchor, role: model.RoleReader, cookie: publishCookie, target: publicDocID},
			{anchor: privateAnchor, role: model.RoleAdministrator, target: publicDocID},
		} {
			body := fmt.Sprintf(`{"anchor":%q,"notebook":%q}`, test.anchor, boxID)
			response := postWithCookie(test.role, test.cookie, path, body, route...)
			defs, ok := response["data"].(map[string]any)["refDefs"].([]any)
			if response["code"] != float64(0) || !ok {
				t.Fatalf("lookup %q returned an invalid response: %v", test.anchor, response)
			}
			if test.target == "" {
				if len(defs) != 0 {
					t.Fatalf("lookup %q returned unavailable references: %v", test.anchor, defs)
				}
			} else if len(defs) != 1 || defs[0].(map[string]any)["refID"] != test.target {
				t.Fatalf("lookup %q did not return %s: %v", test.anchor, test.target, defs)
			}
		}
	})

	t.Run("ContractReaderVirtualReferenceLabels", func(t *testing.T) {
		const path = "/api/filetree/getDoc"
		route := contractRouteHandlers(apicontract.GetDoc, getDoc)
		body := fmt.Sprintf(`{"id":%q,"size":32}`, publicDocID)
		for _, cookie := range []*http.Cookie{nil, publishCookie} {
			response := postWithCookie(model.RoleReader, cookie, path, body, route...)
			content, ok := response["data"].(map[string]any)["content"].(string)
			want := 1
			if cookie != nil {
				want = 2
			}
			if !ok || strings.Count(content, "virtual-block-ref") != want {
				t.Fatalf("reader did not receive %d virtual reference labels: %v", want, response)
			}
		}
	})
}
