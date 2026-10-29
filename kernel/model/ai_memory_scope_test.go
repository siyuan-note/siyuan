// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/memo"
	"github.com/siyuan-note/siyuan/kernel/treenode"
)

func TestAIMemoryDefaultNotebookScope(t *testing.T) {
	fixture := setupFileOperationTest(t)
	ctx := context.Background()
	for _, legacySources := range []string{`[]`, `["not-a-notebook"]`, `["` + fixture.box.ID + `"]`} {
		t.Run(legacySources, func(t *testing.T) {
			cfg := conf.NewAI()
			if err := json.Unmarshal([]byte(`{"memory":{"enabled":true,"sources":`+legacySources+`}}`), cfg); err != nil {
				t.Fatal(err)
			}
			Conf.AI.Store(conf.NormalizeAI(cfg))
			source, err := memorySource(ctx, fixture.childID)
			if err != nil {
				t.Fatal("ordinary notebook requires no selection", err)
			}
			record := memo.Record{Schema: 1, Kind: "fact", Subject: "test", Scope: "workspace", State: "active", Content: "test", Sources: []memo.Source{source}}
			if !validateMemorySources(ctx, record) || !memoryModelReadAllowed(ctx, record) {
				t.Fatal("ordinary source failed validation or model-read authorization")
			}
			markRuntimeEncryptedBox(fixture.box.ID)
			defer forgetRuntimeEncryptedBox(fixture.box.ID)
			if _, err = memorySource(ctx, fixture.childID); err == nil || validateMemorySources(ctx, record) || memoryModelReadAllowed(ctx, record) {
				t.Fatal("encrypted notebook accepted, including previously selected notebook")
			}
		})
	}
	// 配置已保存后新建的普通笔记本无需刷新来源列表。
	box := &Box{ID: "20261029000000-newbox1"}
	if err := box.SaveConf(conf.NewBoxConf()); err != nil {
		t.Fatal(err)
	}
	tree := treenode.NewTree(box.ID, "/20261029000000-newdoc1.sy", "/New", "New")
	if _, err := filesys.WriteTree(tree); err != nil {
		t.Fatal(err)
	}
	treenode.UpsertBlockTree(tree)
	if _, err := memorySource(ctx, tree.ID); err != nil {
		t.Fatal("new notebook was not included automatically", err)
	}
}
