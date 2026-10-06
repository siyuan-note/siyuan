// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// TestInsertBlockRejectsDocumentSiblingAnchor 覆盖 insertBlock 以文档 ID 作为同级锚点的场景。
// 文档 ID 格式合法，但不是合法的同级锚点：事务层会越过文档根插入，随后读取 insertedNode.Parent 时空指针 panic。
// 因此 previousID / nextID 指向文档时必须返回可读的参数错误，而不是让内核崩溃。
// 注意 parentID 指向文档表示插入到文档末尾，属于合法用法，不能用同一个校验拦掉。
func TestInsertBlockRejectsDocumentSiblingAnchor(t *testing.T) {
	originalPath := util.BlockTreeDBPath
	util.BlockTreeDBPath = filepath.Join(t.TempDir(), "blocktree.db")
	treenode.InitBlockTree(true)
	t.Cleanup(func() {
		treenode.CloseDatabase()
		util.BlockTreeDBPath = originalPath
		if originalPath != "" {
			treenode.InitBlockTree(false)
		}
	})
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	engine.Use(model.Recover)
	engine.POST("/insert", insertBlock)

	docID := ast.NewNodeID()
	treenode.UpsertBlockTree(treenode.NewTree("20260908000000-boxid01", "/"+docID+".sy", "/Test", "Test"))
	post := func(body string) (int, string) {
		t.Helper()
		recorder := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodPost, "/insert", strings.NewReader(body))
		request.Header.Set("Content-Type", "application/json")
		engine.ServeHTTP(recorder, request)
		var response struct {
			Code int    `json:"code"`
			Msg  string `json:"msg"`
		}
		if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
			t.Fatalf("response is not JSON: %s, %v", recorder.Body.String(), err)
		}
		return response.Code, response.Msg
	}

	// 文档 ID 必须被识别为非法同级锚点，并给出可读原因。
	code, msg := post(`{"previousID":"` + docID + `","data":"test","dataType":"markdown"}`)
	if code != -1 {
		t.Fatalf("previousID set to a document must be rejected, got code=%d msg=%q", code, msg)
	}
	if !strings.Contains(msg, "can not be the ID of a document") {
		t.Fatalf("previousID set to a document must explain the document anchor, got %q", msg)
	}
	// 不存在的块同样必须被拒绝，且原因与「文档」区分开。
	code, msg = post(`{"previousID":"20260908000000-missing","data":"test","dataType":"markdown"}`)
	if code != -1 {
		t.Fatalf("unknown previousID must be rejected, got code=%d msg=%q", code, msg)
	}
	if !strings.Contains(msg, "not found") {
		t.Fatalf("unknown previousID must report a missing block, got %q", msg)
	}

	// parentID 指向文档是合法用法，校验不得误伤。
	_, msg = post(`{"parentID":"` + docID + `","data":"test","dataType":"markdown"}`)
	if strings.Contains(msg, "can not be the ID of a document") {
		t.Fatalf("parentID set to a document must stay allowed, got %q", msg)
	}
}

// TestCheckSiblingAnchor 直接覆盖同级锚点校验：文档被拒绝，其余块类型放行。
func TestCheckSiblingAnchor(t *testing.T) {
	originalPath := util.BlockTreeDBPath
	util.BlockTreeDBPath = filepath.Join(t.TempDir(), "blocktree.db")
	treenode.InitBlockTree(true)
	t.Cleanup(func() {
		treenode.CloseDatabase()
		util.BlockTreeDBPath = originalPath
		if originalPath != "" {
			treenode.InitBlockTree(false)
		}
	})

	docID := ast.NewNodeID()
	treenode.UpsertBlockTree(treenode.NewTree("20260908000000-boxid01", "/"+docID+".sy", "/Test", "Test"))
	if err := treenode.CheckSiblingAnchor(docID); err == nil {
		t.Fatal("a document must not be accepted as a sibling anchor")
	} else if !strings.Contains(err.Error(), "can not be the ID of a document") {
		t.Fatalf("document anchor error must be explicit, got %q", err.Error())
	}
	if err := treenode.CheckSiblingAnchor("20260908000000-missing"); err == nil {
		t.Fatal("a missing block must not be accepted as a sibling anchor")
	} else if !strings.Contains(err.Error(), "not found") {
		t.Fatalf("missing block error must be explicit, got %q", err.Error())
	}
	// 非文档块放行，校验不能过宽。
	paragraphID := ast.NewNodeID()
	paragraph := treenode.NewTree("20260908000000-boxid02", "/"+paragraphID+".sy", "/Test", "Test")
	paragraph.Root.Type = ast.NodeParagraph
	treenode.UpsertBlockTree(paragraph)
	if err := treenode.CheckSiblingAnchor(paragraphID); err != nil {
		t.Fatalf("a non-document block must stay allowed, got %q", err.Error())
	}
}
