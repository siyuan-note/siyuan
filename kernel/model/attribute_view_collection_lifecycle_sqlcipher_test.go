// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5 && (sqlcipher || libsqlcipher)

package model

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestBlockCollectionEncryptedDatabaseLifecycle(t *testing.T) {
	for _, mode := range []string{"block", "document", "authentication"} {
		t.Run(mode, func(t *testing.T) {
			if !prepareStructuredTitlesCryptoTest(t) {
				return
			}
			util.Lang = "en"
			util.AttrViewLangs = map[string]map[string]any{"en": {"key": "Key", "table": "Table", "select": "Select"}}
			box := newStructuredTitlesEncryptedBox(t)
			setupAutomationNotificationLanguage(t)
			host := createStructuredTitlesEncryptedDoc(t, box, nil, "Database")
			source := createStructuredTitlesEncryptedDoc(t, box, nil, "Source")
			view := av.NewAttributeView(ast.NewNodeID())
			view.Automations = &av.AutomationConfig{Spec: 1, Rules: []*av.AutomationRule{{
				ID: ast.NewNodeID(), Name: "Collect", Enabled: true, Trigger: "block",
				BlockSource: &av.AutomationBlockSource{DocumentIDs: []string{source.ID}, Types: []string{"d"},
					Attributes: []*av.AutomationBlockAttribute{{Name: "custom-state", Operator: "equals", Value: "active"}}},
				Actions: []*av.AutomationAction{{Type: "collect", Target: "current"}},
			}}}
			av.SetAVBoxID(view.ID, box)
			if err := av.SaveAttributeView(view); err != nil {
				t.Fatal(err)
			}
			id := addCollectionDatabaseBlock(t, view, host.ID)
			changeState := func(state string) *Transaction {
				data, _ := json.Marshal(map[string]string{"custom-state": state})
				return &Transaction{fromAPI: true, DoOperations: []*Operation{{Action: "setAttrs", ID: source.ID, Data: string(data)}}}
			}
			undo := &Operation{Action: "insert", ID: id, ParentID: host.ID, Data: GetBlockDOM(id)}
			filename := filepath.Join(util.DataDir, box, host.Path)
			var corrupted []byte
			var err error
			switch mode {
			case "block":
				err = PerformTxSync(&Transaction{fromAPI: true, DoOperations: []*Operation{{Action: "delete", ID: id}}, UndoOperations: []*Operation{undo}})
			case "document":
				err = RemoveDoc(box, host.Path)
			case "authentication":
				corrupted, err = os.ReadFile(filename)
				if err == nil {
					corrupted[len(corrupted)-1] ^= 1
					err = os.WriteFile(filename, corrupted, 0600)
				}
			}
			if err != nil {
				t.Fatal(err)
			}
			cache.ClearAVCache()
			messages := []string{}
			tx := changeState("active")
			captureAutomationNotifications(t, tx, &messages)
			err = PerformTxSync(tx)
			if (err != nil) != (mode == "authentication") || len(messages) != 0 {
				t.Fatal("private deleted database ran collection or hid authentication failure", err, messages)
			}
			stored, err := av.ParseAttributeViewForIndexInBox(view.ID, box)
			if err != nil || len(stored.GetBlockKeyValues().Values) != 0 || !stored.Automations.Rules[0].Enabled {
				t.Fatal("private database data or rule changed", err)
			}
			if mode == "authentication" {
				assertEncryptedFileBytes(t, filename, corrupted)
			}
			if mode == "block" {
				if err = PerformTxSync(&Transaction{isReplay: true, DoOperations: []*Operation{undo}}); err != nil {
					t.Fatal(err)
				}
				for _, state := range []string{"", "active"} {
					if err = PerformTxSync(changeState(state)); err != nil {
						t.Fatal(err)
					}
				}
				stored, err = av.ParseAttributeViewForIndexInBox(view.ID, box)
				if err != nil || stored.GetBlockValueByBoundID(source.ID) == nil {
					t.Fatal("private collection did not resume after undo", err)
				}
			}
		})
	}
}
