// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5

package model

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestExternalBlockWritesRejectIdentityConflicts(t *testing.T) {
	fixture := setupStructureTransactionTest(t)
	setupFoldTransactionDatabase(t, fixture)
	tree, err := LoadTreeByBlockID(fixture.sourceID)
	if err != nil {
		t.Fatal(err)
	}
	existing := tree.Root.FirstChild.ID
	file := filepath.Join(util.DataDir, fixture.box.ID, fixture.sourcePath)
	before, err := os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}
	const newID = "20261106000000-newpara"
	paragraph := func(id string) string {
		return `<div data-type="NodeParagraph" data-node-id="` + id + `"><div contenteditable="true">test</div></div>`
	}
	for _, action := range []string{"appendInsert", "prependInsert", "insert"} {
		for _, data := range []string{
			paragraph("short"), paragraph(newID) + paragraph(newID), paragraph(existing), paragraph(fixture.sourceID),
			`<div data-type="NodeBlockquote" data-node-id="` + ast.NewNodeID() + `">` + paragraph("short") + `</div>`,
		} {
			op := &Operation{Action: action, ParentID: fixture.sourceID, Data: data}
			if action == "insert" {
				op.PreviousID = existing
			}
			if _, err = PerformBlockOperation(op); err == nil {
				t.Fatalf("%s accepted conflicting identities: %s", action, data)
			}
			after, _ := os.ReadFile(file)
			if string(before) != string(after) {
				t.Fatal("rejected insert changed source data")
			}
		}
	}
	for _, data := range []string{
		paragraph(fixture.sourceID), paragraph(newID) + paragraph(newID),
	} {
		if _, _, err = PerformBlockUpdates([]BlockUpdateInput{{ID: fixture.sourceID, Data: data, DataType: "dom"}}); err == nil {
			t.Fatal("document replacement accepted conflicting identities")
		}
		after, _ := os.ReadFile(file)
		if string(before) != string(after) {
			t.Fatal("rejected replacement changed source data")
		}
	}
	if _, _, err = PerformBlockUpdates([]BlockUpdateInput{{ID: fixture.sourceID, Data: "> first\n\nsecond", DataType: "markdown"}}); err != nil {
		t.Fatalf("container-first document replacement failed: %v", err)
	}
	cache.RemoveTreeData(fixture.sourceID)
	tree, err = LoadTreeByBlockID(fixture.sourceID)
	if err != nil {
		t.Fatal(err)
	}
	seen := map[string]bool{fixture.sourceID: true}
	ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
		if entering && n.IsBlock() && n.Type != ast.NodeDocument && n.Type != ast.NodeKramdownBlockIAL {
			if !ast.IsNodeIDPattern(n.ID) || seen[n.ID] {
				t.Fatalf("invalid document identity [%s]", n.ID)
			}
			seen[n.ID] = true
		}
		return ast.WalkContinue
	})
	engine := util.NewLute()
	if !strings.Contains(engine.Tree2BlockDOM(tree, engine.RenderOptions, engine.ParseOptions), "first") {
		t.Fatal("document replacement lost content")
	}
}
