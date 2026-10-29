// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAPIContractDocTreeRangeAndLocate(t *testing.T) {
	if os.Getenv("SIYUAN_TEST_DOC_TREE_RANGE_CONTRACT") != "1" {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		command := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestAPIContractDocTreeRangeAndLocate$")
		command.Env = append(os.Environ(), "SIYUAN_TEST_DOC_TREE_RANGE_CONTRACT=1")
		if output, err := command.CombinedOutput(); err != nil {
			t.Fatalf("document tree range contract subprocess failed: %v\n%s", err, output)
		}
		return
	}
	box := documentPathAPIWorkspace(t)
	oldTime, oldLang := util.TimeLangs, model.Conf.Lang
	var language struct {
		Time map[string]interface{} `json:"_time"`
	}
	content, err := os.ReadFile(filepath.Join("..", "..", "app", "appearance", "langs", "en.json"))
	if err != nil || json.Unmarshal(content, &language) != nil {
		t.Fatal("load time language fixture failed")
	}
	model.Conf.Lang = "en"
	util.TimeLangs = map[string]map[string]interface{}{"en": language.Time}
	t.Cleanup(func() { util.TimeLangs, model.Conf.Lang = oldTime, oldLang })
	for index, id := range []string{"20261023050000-doc0001", "20261023050001-doc0002", "20261023050002-hidden1"} {
		tree := treenode.NewTree(box, "/"+id+".sy", "/Document", "Document")
		if index == 2 {
			tree.Root.SetIALAttr(model.DocHiddenAttr, "true")
		}
		if _, err = filesys.WriteTree(tree); err != nil {
			t.Fatal(err)
		}
		treenode.UpsertBlockTree(tree)
	}
	model.Conf.FileTree.Load().DocTreeBatchSize = new(1)
	var response struct {
		Code int                           `json:"code"`
		Data apicontract.FileTreeRangeData `json:"data"`
	}
	request := apicontract.FileTreeRangeRequest{Notebook: box, ParentID: "", Offset: 0}
	body := documentPathAPIRequest(t, "/api/filetree/listDocTreeRange", listDocTreeRange, request)
	if err = json.Unmarshal(body, &response); err != nil || response.Code != 0 || response.Data.Total != 2 || len(response.Data.Files) != 1 || response.Data.Limit != 1 {
		t.Fatalf("initial range contract: %s, %v", body, err)
	}
	request.Offset, request.Revision = 1, response.Data.Revision
	body = documentPathAPIRequest(t, "/api/filetree/listDocTreeRange", listDocTreeRange, request)
	if err = json.Unmarshal(body, &response); err != nil || response.Code != 0 || response.Data.Stale || len(response.Data.Files) != 1 {
		t.Fatalf("next range contract: %s, %v", body, err)
	}
	var locate struct {
		Code int                            `json:"code"`
		Data apicontract.FileTreeLocateData `json:"data"`
	}
	body = documentPathAPIRequest(t, "/api/filetree/locateDocTreeItem", locateDocTreeItem,
		apicontract.FileTreeLocateRequest{Notebook: box, ID: response.Data.Files[0].ID})
	if err = json.Unmarshal(body, &locate); err != nil || locate.Code != 0 || len(locate.Data.Steps) != 1 || locate.Data.Steps[0].Index != 1 {
		t.Fatalf("locate contract: %s, %v", body, err)
	}
	for _, extra := range []map[string]interface{}{
		{"offset": -1}, {"offset": 0.5}, {"offset": "0"}, {"offset": nil}, {"limit": 0}, {"limit": 10241}, {"limit": 1.5}, {"limit": nil},
		{"parentID": "../parent"}, {"parentID": "20261023050002-hidden1"}, {"parentID": "20261023050009-missing"},
	} {
		input := map[string]interface{}{"notebook": box, "parentID": "", "offset": 0}
		for key, value := range extra {
			input[key] = value
		}
		body = documentPathAPIRequest(t, "/api/filetree/listDocTreeRange", listDocTreeRange, input)
		var failure struct {
			Code int `json:"code"`
		}
		if err = json.Unmarshal(body, &failure); err != nil || failure.Code == 0 {
			t.Fatalf("invalid range accepted: %v: %s", input, body)
		}
	}
	request.Offset, request.Revision = 0, "old-revision"
	body = documentPathAPIRequest(t, "/api/filetree/listDocTreeRange", listDocTreeRange, request)
	if err = json.Unmarshal(body, &response); err != nil || response.Code != 0 || !response.Data.Stale || len(response.Data.Files) != 0 {
		t.Fatalf("stale contract: %s, %v", body, err)
	}
	// 已关闭的普通笔记本也不能通过旧的缓存继续访问。
	notebook := model.Conf.Box(box)
	boxConf := notebook.GetConf()
	boxConf.Closed = true
	if err = notebook.SaveConf(boxConf); err != nil {
		t.Fatal(err)
	}
	body = documentPathAPIRequest(t, "/api/filetree/listDocTreeRange", listDocTreeRange, request)
	if err = json.Unmarshal(body, &response); err != nil || response.Code == 0 {
		t.Fatalf("closed notebook accepted: %s, %v", body, err)
	}
}

func TestAPIContractDocTreeRangePublishDeniesNotebook(t *testing.T) {
	box := documentPathAPIWorkspace(t)
	previous := model.GetPublishAccess()
	if err := model.SetPublishAccess(model.PublishAccess{{ID: box, Visible: false, Disable: true}}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = model.SetPublishAccess(previous) })
	reader := func(c *gin.Context) { c.Set(model.RoleContextKey, model.RoleReader); listDocTreeRange(c) }
	body := documentPathAPIRequest(t, "/api/filetree/listDocTreeRange", reader,
		apicontract.FileTreeRangeRequest{Notebook: box, ParentID: "", Offset: 0})
	var response struct {
		Code int             `json:"code"`
		Data json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(body, &response); err != nil || response.Code == 0 || string(response.Data) != "null" {
		t.Fatalf("denied notebook leaked a count: %s, %v", body, err)
	}
}
