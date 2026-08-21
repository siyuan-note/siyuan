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
	"reflect"
	"strings"
	"testing"
	"unsafe"

	"github.com/88250/lute/parse"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/model"
)

func TestShouldBroadcastAttrViewTransactions(t *testing.T) {
	transactions := []*model.Transaction{{DoOperations: []*model.Operation{
		{Action: "restoreCreatedDoc"},
		{Action: "insertAttrViewBlock"},
	}}}
	if !shouldBroadcastAttrViewTransactions(transactions) {
		t.Fatal("attribute view operation after an internal operation should be broadcast to the initiating client")
	}

	transactions[0].DoOperations = []*model.Operation{{Action: "setAttrViewName"}}
	if shouldBroadcastAttrViewTransactions(transactions) {
		t.Fatal("attribute view name updates should keep using optimistic local updates")
	}
}

// recordCrossDocUndoEntry 在全局撤销日志中记录一笔跨文档事务，使公开文档的栈顶
// 关联私有文档 rootID，用于复现 undoState 只读角色泄露场景。
func recordCrossDocUndoEntry(publicRootID, privateRootID string) {
	tx := &model.Transaction{
		UndoOperations: []*model.Operation{{Action: "delete", ID: publicRootID}},
	}
	tx.MarkFromAPI()
	treesField := reflect.ValueOf(tx).Elem().FieldByName("trees")
	trees := map[string]*parse.Tree{publicRootID: {}, privateRootID: {}}
	reflect.NewAt(treesField.Type(), unsafe.Pointer(treesField.UnsafeAddr())).Elem().
		Set(reflect.ValueOf(trees))
	model.GlobalUndoLog.Record(tx)
}

func TestUndoStateRedactsMutatedRootIDsForReadOnlyRoles(t *testing.T) {
	const (
		publicRootID  = "20260821000000-public1"
		privateRootID = "20260821000001-privat1"
	)
	model.GlobalUndoLog.Clear("")
	defer model.GlobalUndoLog.Clear("")
	recordCrossDocUndoEntry(publicRootID, privateRootID)

	gin.SetMode(gin.TestMode)
	engine := gin.New()
	engine.POST("/api/transactions/undoState", func(c *gin.Context) {
		c.Set(model.RoleContextKey, model.RoleReader)
		undoState(c)
	})

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/transactions/undoState",
		strings.NewReader(`{"rootID":"`+publicRootID+`"}`))
	request.Header.Set("Content-Type", "application/json")
	engine.ServeHTTP(recorder, request)

	var response struct {
		Data struct {
			CanUndo            bool     `json:"canUndo"`
			CanRedo            bool     `json:"canRedo"`
			PeekMutatedRootIDs []string `json:"peekMutatedRootIDs"`
		} `json:"data"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); nil != err {
		t.Fatalf("unmarshal response failed: %v", err)
	}
	if !response.Data.CanUndo {
		t.Fatal("reader should still see the canUndo state")
	}
	if 0 != len(response.Data.PeekMutatedRootIDs) {
		t.Fatalf("reader should not see mutated root IDs, got %v", response.Data.PeekMutatedRootIDs)
	}
}

func TestUndoStateReturnsMutatedRootIDsForEditors(t *testing.T) {
	const (
		publicRootID  = "20260821000000-public2"
		privateRootID = "20260821000001-privat2"
	)
	model.GlobalUndoLog.Clear("")
	defer model.GlobalUndoLog.Clear("")
	recordCrossDocUndoEntry(publicRootID, privateRootID)

	gin.SetMode(gin.TestMode)
	engine := gin.New()
	engine.POST("/api/transactions/undoState", func(c *gin.Context) {
		c.Set(model.RoleContextKey, model.RoleEditor)
		undoState(c)
	})

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/transactions/undoState",
		strings.NewReader(`{"rootID":"`+publicRootID+`"}`))
	request.Header.Set("Content-Type", "application/json")
	engine.ServeHTTP(recorder, request)

	var response struct {
		Data struct {
			CanUndo            bool     `json:"canUndo"`
			CanRedo            bool     `json:"canRedo"`
			PeekMutatedRootIDs []string `json:"peekMutatedRootIDs"`
		} `json:"data"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); nil != err {
		t.Fatalf("unmarshal response failed: %v", err)
	}
	if !response.Data.CanUndo {
		t.Fatal("editor should see the canUndo state")
	}
	if 2 != len(response.Data.PeekMutatedRootIDs) {
		t.Fatalf("editor should see both mutated root IDs, got %v", response.Data.PeekMutatedRootIDs)
	}
}
