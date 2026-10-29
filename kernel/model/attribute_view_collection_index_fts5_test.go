// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5

package model

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestBlockCollectionIndexSkipsStateWithoutRules(t *testing.T) {
	fixture, view, _ := setupBlockCollectionTest(t)
	view.Automations.Rules[0].Enabled = false
	if err := av.SaveAttributeView(view); err != nil {
		t.Fatal(err)
	}
	cache.ClearAVCache()
	tree, err := LoadTreeByBlockID(fixture.sourceID)
	if err != nil {
		t.Fatal(err)
	}
	op := &Operation{Action: "update", ID: tree.ID}
	for range 2 {
		tx := &Transaction{fromAPI: true, DoOperations: []*Operation{op}}
		if err = tx.captureCollectionTree(tree); err != nil || tx.attributeViewCollections != nil || tx.attributeViewAutomations != nil {
			t.Fatal("empty rule set allocated collection state", err)
		}
	}
	view.Automations.Rules[0].Enabled = true
	if err = av.SaveAttributeView(view); err != nil {
		t.Fatal(err)
	}
	tx := &Transaction{fromAPI: true, luteEngine: util.NewLute(), DoOperations: []*Operation{op}}
	if err = tx.captureCollectionTree(tree); err != nil || tx.attributeViewAutomations == nil || tx.attributeViewCollections.before[tree.ID] == nil {
		t.Fatal("enabling rule did not capture source snapshot", err)
	}
}

func TestBlockCollectionIndexFiltersBeforeFullParse(t *testing.T) {
	fixture, view, _ := setupBlockCollectionTest(t)
	// 范围头部有效，但完整数据库字段无法解码，用于验证无关编辑不会走完整解析。
	data, err := json.Marshal(map[string]any{"id": view.ID, "spec": av.PlainTextSpec,
		"automations": view.Automations, "keyValues": "invalid full database body"})
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(util.DataDir, "storage", "av", view.ID+".json")
	if err = os.WriteFile(path, data, 0600); err != nil {
		t.Fatal(err)
	}
	cache.ClearAVCache()
	otherID := ast.NewNodeID()
	tree, err := LoadTreeByBlockID(fixture.sourceID)
	if err != nil {
		t.Fatal(err)
	}
	unrelated := *tree
	unrelated.ID, unrelated.Path = otherID, "/"+otherID+".sy"
	tx := &Transaction{fromAPI: true, DoOperations: []*Operation{{Action: "update", ID: otherID}}}
	if err = tx.captureCollectionTree(&unrelated); err != nil {
		t.Fatal("unrelated edit parsed full database", err)
	}
	index := tx.attributeViewCollections.indexes[""]
	unrelated.ID = ast.NewNodeID()
	unrelated.Path = "/" + unrelated.ID + ".sy"
	if err = tx.captureCollectionTree(&unrelated); err != nil || tx.attributeViewCollections.indexes[""] != index ||
		len(tx.attributeViewCollections.indexes) != 1 || len(tx.attributeViewCollections.views) != 0 || tx.attributeViewAutomations != nil {
		t.Fatal("multiple unrelated documents did not reuse boundary snapshot", err)
	}
	if err = tx.captureCollectionTree(tree); err == nil || tx.attributeViewCollections.err == nil {
		t.Fatal("matching document suppressed full database error")
	}
	if handled, attrErr := performCollectionAttributeOperations([]map[string]any{{
		"id": fixture.targetID, "attrs": map[string]string{"custom-state": "active"},
	}}, false); attrErr != nil || handled {
		t.Fatal("unrelated attribute API forced collection transaction", attrErr)
	}
	createdID := ast.NewNodeID()
	created := treenode.NewTree(fixture.box.ID, "/"+createdID+".sy", "/Unrelated", "Unrelated")
	if err = performCreateDocTransaction(created, false); err != nil {
		t.Fatal("unrelated creation parsed full database", err)
	}
	if _, err = LoadTreeByBlockID(createdID); err != nil {
		t.Fatal("unrelated creation did not commit", err)
	}
}
