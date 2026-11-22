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

// TestReaderLocalGraphWithoutDeniedBox 校验读者局部关系图不返回被禁用发布文档所属笔记本标识，
// 同时可见文档仍返回自己的笔记本标识。
func TestReaderLocalGraphWithoutDeniedBox(t *testing.T) {
	const helper = "SIYUAN_TEST_READER_GRAPH_BOX"
	if os.Getenv(helper) != "1" {
		ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
		defer cancel()
		command := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestReaderLocalGraphWithoutDeniedBox$", "-test.v")
		command.Env = append(os.Environ(), helper+"=1")
		if output, err := command.CombinedOutput(); err != nil {
			t.Fatalf("reader graph subprocess failed: %v\n%s", err, output)
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
	model.Conf.Graph.Store(conf.NewGraph())
	model.Conf.NotebookCrypto = conf.NewNotebookCrypto()

	sql.InitDatabase(true)
	sql.InitHistoryDatabase(true)
	sql.InitAssetContentDatabase(true)
	treenode.InitBlockTree(true)
	defer treenode.CloseDatabase()
	defer sql.CloseDatabase()

	const (
		deniedBoxID  = "20261122000010-boxgrp1"
		deniedDocID  = "20261122000011-docgrp1"
		visibleBoxID = "20261122000012-boxgrp2"
		visibleDocID = "20261122000013-docgrp2"
	)

	addDoc := func(boxID, docID string) {
		t.Helper()
		box := &model.Box{ID: boxID}
		boxConf := conf.NewBoxConf()
		boxConf.Name = boxID
		if err := box.SaveConf(boxConf); err != nil {
			t.Fatalf("save box conf: %v", err)
		}
		tree := treenode.NewTree(boxID, "/"+docID+".sy", "/"+docID, docID)
		tree.Root.FirstChild.Unlink()
		paragraph := treenode.NewParagraph(ast.NewNodeID())
		paragraph.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("graph content")})
		tree.Root.AppendChild(paragraph)
		if _, err := filesys.WriteTree(tree); err != nil {
			t.Fatalf("write tree: %v", err)
		}
		treenode.IndexBlockTree(tree)
		sql.IndexTreeQueue(tree)
	}
	addDoc(deniedBoxID, deniedDocID)
	addDoc(visibleBoxID, visibleDocID)
	sql.FlushQueue()

	if err := model.SetPublishAccess(model.PublishAccess{{ID: deniedDocID, Visible: true, Disable: true}}); err != nil {
		t.Fatalf("set publish access: %v", err)
	}

	graph := func(role model.Role, docID string) (box string, nodes int) {
		t.Helper()
		gin.SetMode(gin.TestMode)
		engine := gin.New()
		engine.Use(func(c *gin.Context) {
			c.Set(model.RoleContextKey, role)
			c.Next()
		})
		engine.POST("/api/graph/getLocalGraph", getLocalGraph)
		body := fmt.Sprintf(`{"id":%q,"reqId":1,"conf":{}}`, docID)
		recorder := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodPost, "/api/graph/getLocalGraph", strings.NewReader(body))
		request.Header.Set("Content-Type", "application/json")
		engine.ServeHTTP(recorder, request)
		var response struct {
			Code int `json:"code"`
			Data struct {
				Box   string `json:"box"`
				Nodes []any  `json:"nodes"`
			} `json:"data"`
		}
		if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil || response.Code != 0 {
			t.Fatalf("local graph response failed: %s, %v", recorder.Body.String(), err)
		}
		return response.Data.Box, len(response.Data.Nodes)
	}

	if box, nodes := graph(model.RoleReader, deniedDocID); box != "" || nodes != 0 {
		t.Fatalf("reader local graph exposed denied notebook: box=%q nodes=%d", box, nodes)
	}
	if box, _ := graph(model.RoleReader, visibleDocID); box != visibleBoxID {
		t.Fatalf("reader local graph dropped visible notebook: box=%q want=%q", box, visibleBoxID)
	}
	if box, _ := graph(model.RoleAdministrator, deniedDocID); box != deniedBoxID {
		t.Fatalf("administrator local graph changed: box=%q want=%q", box, deniedBoxID)
	}
}
