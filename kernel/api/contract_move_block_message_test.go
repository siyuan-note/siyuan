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

// TestMoveBlockRejectsPreviousIDDistinguishesMissingAndDocument 覆盖 moveBlock 对 previousID 的错误提示。
// 文档 ID 格式合法但不是同级锚点，块不存在则是调用方传了失效 ID；
// 两种情况必须给出可区分的提示，否则排查时会被「不是文档」误导。
func TestMoveBlockRejectsPreviousIDDistinguishesMissingAndDocument(t *testing.T) {
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
	engine.POST("/move", moveBlock)

	docID := ast.NewNodeID()
	treenode.UpsertBlockTree(treenode.NewTree("20260908000000-boxid01", "/"+docID+".sy", "/Test", "Test"))
	// moveBlock 先校验 id 指向的块是否存在，因此需要一个真实存在的块作为 id。
	itemID := ast.NewNodeID()
	paragraph := treenode.NewTree("20260908000000-boxid02", "/"+itemID+".sy", "/Test", "Test")
	paragraph.Root.Type = ast.NodeParagraph
	treenode.UpsertBlockTree(paragraph)
	post := func(body string) (int, string) {
		t.Helper()
		recorder := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodPost, "/move", strings.NewReader(body))
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

	// 不存在的块：必须报「找不到」，不能报「不能是文档 ID」。
	code, msg := post(`{"id":"` + itemID + `","previousID":"20260908000000-nothere"}`)
	if code != -1 {
		t.Fatalf("unknown previousID must be rejected, got code=%d msg=%q", code, msg)
	}
	if strings.Contains(msg, "can not be the ID of a document") {
		t.Fatalf("a missing block must not be reported as a document, got %q", msg)
	}
	if !strings.Contains(msg, "not found") {
		t.Fatalf("a missing block must report not found, got %q", msg)
	}

	// 文档：仍须明确说明它不能作为同级锚点。
	code, msg = post(`{"id":"` + itemID + `","previousID":"` + docID + `"}`)
	if code != -1 {
		t.Fatalf("document previousID must be rejected, got code=%d msg=%q", code, msg)
	}
	if !strings.Contains(msg, "can not be the ID of a document") {
		t.Fatalf("a document must be reported as a document, got %q", msg)
	}
}
