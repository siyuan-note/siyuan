// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

package api

import (
	"bytes"
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// testAPIContractInsertBlockAnchors 复用隔离进程中的真实文档，验证参数错误、定位优先级和落盘位置。
func testAPIContractInsertBlockAnchors(t *testing.T, boxID, docID, paragraphID string) {
	engine := gin.New()
	const path = "/api/block/insertBlock"
	engine.POST(path, insertBlock)
	post := func(t *testing.T, request map[string]any) (response struct {
		Code int                             `json:"code"`
		Msg  string                          `json:"msg"`
		Data []*apicontract.BlockTransaction `json:"data"`
	}) {
		t.Helper()
		body, err := json.Marshal(request)
		if err != nil {
			t.Fatal(err)
		}
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, httptest.NewRequest("POST", path, bytes.NewReader(body)))
		requireAPIContract(t, "POST", path, recorder)
		if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
			t.Fatal(err)
		}
		return
	}
	readDocument := func(t *testing.T) []byte {
		t.Helper()
		data, err := os.ReadFile(filepath.Join(util.DataDir, boxID, docID+".sy"))
		if err != nil {
			t.Fatal(err)
		}
		return data
	}
	const missingID = "20260908000000-missing"
	for _, dataType := range []string{"markdown", "dom"} {
		data := "anchor contract test"
		if dataType == "dom" {
			data = util.NewLute().Md2BlockDOM(data, false)
		}
		for _, field := range []string{"previousID", "nextID"} {
			for _, anchor := range []struct{ name, id, message string }{
				{"document", docID, "`" + field + "` cannot be the ID of a document"},
				{"missing", missingID, "not found"},
			} {
				t.Run("insert-anchor/"+dataType+"/"+field+"/"+anchor.name, func(t *testing.T) {
					before := readDocument(t)
					response := post(t, map[string]any{
						"data": data, "dataType": dataType, "parentID": docID, field: anchor.id,
					})
					if response.Code != -1 || response.Data != nil ||
						!strings.Contains(response.Msg, anchor.message) || strings.Contains(response.Msg, "panic") {
						t.Fatalf("expected explicit anchor error, got %+v", response)
					}
					if !bytes.Equal(before, readDocument(t)) {
						t.Fatal("rejected insert changed the document")
					}
				})
			}
		}
		for _, test := range []struct {
			name, previousID, nextID, position string
		}{
			{"previous-block", paragraphID, "", "after"},
			{"next-block", "", paragraphID, "before"},
			{"document-parent", "", "", "first"},
			{"next-priority-document-previous", docID, paragraphID, "before"},
			{"next-priority-missing-previous", missingID, paragraphID, "before"},
		} {
			t.Run("insert-anchor/"+dataType+"/"+test.name, func(t *testing.T) {
				response := post(t, map[string]any{
					"data": data, "dataType": dataType, "parentID": docID,
					"previousID": test.previousID, "nextID": test.nextID,
				})
				if response.Code != 0 || len(response.Data) != 1 || len(response.Data[0].DoOperations) != 1 {
					t.Fatalf("expected successful insert, got %+v", response)
				}
				operation := response.Data[0].DoOperations[0]
				cache.RemoveTreeData(docID)
				tree, err := model.LoadTreeByBlockID(docID)
				if err != nil {
					t.Fatal(err)
				}
				node := treenode.GetNodeInTree(tree, operation.ID)
				if node == nil || node.Parent != tree.Root || operation.ParentID != docID {
					t.Fatalf("inserted block is not persisted under the document: %+v", operation)
				}
				switch test.position {
				case "after":
					if node.Previous == nil || node.Previous.ID != paragraphID {
						t.Fatal("block was not inserted after previousID")
					}
				case "before":
					if node.Next == nil || node.Next.ID != paragraphID {
						t.Fatal("block was not inserted before nextID")
					}
				case "first":
					if tree.Root.FirstChild != node {
						t.Fatal("document parent must insert at the beginning")
					}
				}
				if _, err := model.PerformBlockOperation(&model.Operation{Action: "delete", ID: operation.ID}); err != nil {
					t.Fatal(err)
				}
			})
		}
	}
}
