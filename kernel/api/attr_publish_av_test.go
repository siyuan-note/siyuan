// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"context"
	"encoding/json"
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
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// TestReaderBlockIALHidesDeniedAttributeViewBindings 校验读者拿到的块属性与 Kramdown
// 不再包含指向不可访问属性视图的 custom-avs 绑定，同时保留可访问的绑定。
func TestReaderBlockIALHidesDeniedAttributeViewBindings(t *testing.T) {
	const helper = "SIYUAN_TEST_READER_AV_BINDING"
	if os.Getenv(helper) != "1" {
		ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
		defer cancel()
		command := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestReaderBlockIALHidesDeniedAttributeViewBindings$", "-test.v")
		command.Env = append(os.Environ(), helper+"=1")
		if output, err := command.CombinedOutput(); err != nil {
			t.Fatalf("reader attribute view binding subprocess failed: %v\n%s", err, output)
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
		boxID           = "20261117000000-boxav01"
		carrierDocID    = "20261117000001-cardoc1"
		deniedDocID     = "20261117000002-avdoc01"
		carrierID       = "20261117010001-carr001"
		publicAvID      = "20261117020001-pubav01"
		hiddenAvID      = "20261117020002-hidav01"
		publicAvBlockID = "20261117030001-pubbl01"
		hiddenAvBlockID = "20261117030002-hidbl01"
	)

	box := &model.Box{ID: boxID}
	boxConf := conf.NewBoxConf()
	boxConf.Name = "Reader AV binding"
	if err := box.SaveConf(boxConf); err != nil {
		t.Fatalf("save box conf: %v", err)
	}

	writeTree := func(docID string, nodes ...*ast.Node) {
		tree := treenode.NewTree(boxID, "/"+docID+".sy", "/"+docID, docID)
		tree.Root.FirstChild.Unlink()
		for _, node := range nodes {
			tree.Root.AppendChild(node)
		}
		if _, err := filesys.WriteTree(tree); err != nil {
			t.Fatalf("write tree %s: %v", docID, err)
		}
		treenode.IndexBlockTree(tree)
		sql.IndexTreeQueue(tree)
	}

	carrier := treenode.NewParagraph(carrierID)
	carrier.SetIALAttr("updated", "20260101000001")
	carrier.SetIALAttr("custom-avs", hiddenAvID+","+publicAvID)
	carrier.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("carrier text")})
	writeTree(carrierDocID, carrier, &ast.Node{Type: ast.NodeAttributeView, ID: publicAvBlockID, AttributeViewID: publicAvID})
	writeTree(deniedDocID, &ast.Node{Type: ast.NodeAttributeView, ID: hiddenAvBlockID, AttributeViewID: hiddenAvID})
	sql.FlushQueue()

	av.UpsertBlockRel(publicAvID, publicAvBlockID)
	av.UpsertBlockRel(hiddenAvID, hiddenAvBlockID)
	if err := model.SetPublishAccess(model.PublishAccess{{ID: deniedDocID, Disable: true}}); err != nil {
		t.Fatalf("set publish access: %v", err)
	}

	call := func(role model.Role, path, body string, handler gin.HandlerFunc) map[string]any {
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

	attrsOf := func(role model.Role, path, body string, handler gin.HandlerFunc) map[string]string {
		t.Helper()
		response := call(role, path, body, handler)
		if response["code"] != float64(0) {
			t.Fatalf("%s: response %v", path, response)
		}
		data, _ := response["data"].(map[string]any)
		attrs := map[string]string{}
		for name, value := range data {
			if text, ok := value.(string); ok {
				attrs[name] = text
			}
		}
		return attrs
	}

	readerBody := `{"id":"` + carrierID + `"}`
	for _, endpoint := range []struct {
		name    string
		path    string
		body    string
		handler gin.HandlerFunc
	}{
		{name: "getBlockAttrs", path: "/api/attr/getBlockAttrs", body: readerBody, handler: getBlockAttrs},
		{name: "batchGetBlockAttrs", path: "/api/attr/batchGetBlockAttrs", body: `{"ids":["` + carrierID + `"]}`, handler: batchGetBlockAttrs},
	} {
		t.Run(endpoint.name, func(t *testing.T) {
			if endpoint.path == "/api/attr/batchGetBlockAttrs" {
				response := call(model.RoleReader, endpoint.path, endpoint.body, endpoint.handler)
				data, _ := response["data"].(map[string]any)
				attrs, _ := data[carrierID].(map[string]any)
				if got, _ := attrs["custom-avs"].(string); got != publicAvID {
					t.Fatalf("reader custom-avs = %q, want %q (response %v)", got, publicAvID, response)
				}
				admin := call(model.RoleAdministrator, endpoint.path, endpoint.body, endpoint.handler)
				adminData, _ := admin["data"].(map[string]any)
				adminAttrs, _ := adminData[carrierID].(map[string]any)
				if got, _ := adminAttrs["custom-avs"].(string); got != hiddenAvID+","+publicAvID {
					t.Fatalf("administrator custom-avs = %q", got)
				}
				return
			}

			reader := attrsOf(model.RoleReader, endpoint.path, endpoint.body, endpoint.handler)
			if got := reader["custom-avs"]; got != publicAvID {
				t.Fatalf("reader custom-avs = %q, want %q", got, publicAvID)
			}
			admin := attrsOf(model.RoleAdministrator, endpoint.path, endpoint.body, endpoint.handler)
			if got := admin["custom-avs"]; got != hiddenAvID+","+publicAvID {
				t.Fatalf("administrator custom-avs = %q", got)
			}
		})
	}

	for _, endpoint := range []struct {
		name    string
		path    string
		body    string
		handler gin.HandlerFunc
	}{
		{name: "getBlockKramdown", path: "/api/block/getBlockKramdown", body: `{"id":"` + carrierID + `"}`, handler: getBlockKramdown},
		{name: "getBlockKramdowns", path: "/api/block/getBlockKramdowns", body: `{"ids":["` + carrierID + `"]}`, handler: getBlockKramdowns},
	} {
		t.Run(endpoint.name, func(t *testing.T) {
			reader := call(model.RoleReader, endpoint.path, endpoint.body, endpoint.handler)
			admin := call(model.RoleAdministrator, endpoint.path, endpoint.body, endpoint.handler)
			readerText, _ := json.Marshal(reader["data"])
			adminText, _ := json.Marshal(admin["data"])
			if strings.Contains(string(readerText), hiddenAvID) {
				t.Fatalf("reader response leaks denied attribute view binding: %s", readerText)
			}
			if !strings.Contains(string(readerText), publicAvID) {
				t.Fatalf("reader response lost accessible attribute view binding: %s", readerText)
			}
			if !strings.Contains(string(adminText), hiddenAvID) {
				t.Fatalf("administrator response lost attribute view binding: %s", adminText)
			}
		})
	}
}
