// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAPIContractAIMemoryClear(t *testing.T) {
	for _, mode := range []string{"complete", "partial", "readonly"} {
		t.Run(mode, func(t *testing.T) {
			aiContractConfiguration(t)
			previousDir, previousReadOnly := util.ConfDir, util.ReadOnly
			util.ConfDir, util.ReadOnly = t.TempDir(), false
			t.Cleanup(func() { util.ConfDir, util.ReadOnly = previousDir, previousReadOnly })
			model.Conf.Sync.Store(conf.NewSync())
			model.Conf.AI.Load().Memory.Enabled = true
			saved, err := model.SaveAIMemory(context.Background(), apicontract.AIMemorySaveRequest{Revision: "missing", OperationID: "clear-test", Content: "An explicit fact", Kind: "fact", Subject: "user", Scope: "workspace", State: "active"})
			if err != nil {
				t.Fatal(err)
			}
			if mode == "partial" {
				name := filepath.Join(util.DataDir, "storage/ai/memos/records/20261031000000-abcdefg.md")
				if err = os.WriteFile(name, []byte("unsupported format"), 0600); err != nil {
					t.Fatal(err)
				}
			}
			util.ReadOnly = mode == "readonly"
			engine := gin.New()
			engine.POST("/api/ai/memory/clear", clearAIMemory)
			w := httptest.NewRecorder()
			previousRevision := model.ConfNamespaceRevision("ai")
			engine.ServeHTTP(w, httptest.NewRequest("POST", "/api/ai/memory/clear", nil))
			requireAPIContract(t, "POST", "/api/ai/memory/clear", w)
			var result struct {
				Code int
				Data apicontract.AIMemoryClearData
			}
			if err = json.Unmarshal(w.Body.Bytes(), &result); err != nil {
				t.Fatal(err)
			}
			if mode == "readonly" {
				if result.Code == 0 || !model.Conf.LoadAI().Memory.Enabled || model.ConfNamespaceRevision("ai") != previousRevision {
					t.Fatalf("readonly clear changed settings: %s", w.Body.String())
				}
			} else if result.Code != 0 || !result.Data.Disabled || result.Data.Cleared != (mode == "complete") || model.Conf.LoadAI().Memory.Enabled {
				t.Fatalf("clear response mismatch: %s", w.Body.String())
			} else if model.ConfNamespaceRevision("ai") <= previousRevision {
				t.Fatal("memory disable did not notify other clients")
			}
			_, readErr := model.GetAIMemory(context.Background(), saved.ID)
			if (readErr != nil) != (mode == "complete") {
				t.Fatalf("record preservation mismatch: %v", readErr)
			}
		})
	}
}
