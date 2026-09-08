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

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestBlockOperationsRejectInvalidArguments(t *testing.T) {
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
	engine.POST("/append", appendBlock)
	engine.POST("/insert", insertBlock)
	engine.POST("/delete", deleteBlock)
	for _, test := range []struct{ path, body string }{
		{"/append", `{"id":"20260908000000-parent1","data":"test","dataType":"markdown"}`},
		{"/append", `{"parentID":42,"data":"test","dataType":"markdown"}`},
		{"/append", `{"parentID":"20260908000000-parent1","data":null,"dataType":"markdown"}`},
		{"/append", `{"parentID":"20260908000000-parent1","data":"test","dataType":"html"}`},
		{"/insert", `{"previousID":"20260908000000-parent1","data":"test"}`},
		{"/insert", `{"data":"test","dataType":"markdown"}`},
		{"/insert", `{"previousID":42,"data":"test","dataType":"markdown"}`},
		{"/insert", `{"previousID":"invalid","data":"test","dataType":"markdown"}`},
		{"/insert", `{"previousID":"20260908000000-parent1","data":"test","dataType":"html"}`},
		{"/delete", `{}`},
		{"/delete", `{"id":42}`},
		{"/delete", `{"id":""}`},
		{"/append", `{"parentID":"20260908000000-missing","data":"test","dataType":"markdown"}`},
		{"/insert", `{"previousID":"20260908000000-missing","data":"test","dataType":"markdown"}`},
		{"/delete", `{"id":"20260908000000-missing"}`},
	} {
		t.Run(test.path+test.body, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			request := httptest.NewRequest(http.MethodPost, test.path, strings.NewReader(test.body))
			request.Header.Set("Content-Type", "application/json")
			engine.ServeHTTP(recorder, request)
			var response struct {
				Code int    `json:"code"`
				Msg  string `json:"msg"`
				Data any    `json:"data"`
			}
			if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
				t.Fatal(err)
			}
			if recorder.Code != http.StatusOK || response.Code == 0 || response.Msg == "" || response.Data != nil {
				t.Fatalf("expected explicit error without operations, got %s", recorder.Body.String())
			}
		})
	}
}
