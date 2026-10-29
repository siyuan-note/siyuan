// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5

package model

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestCrossTreeMoveQueuesPersistentReferenceRepair(t *testing.T) {
	fixture := setupStructureTransactionTest(t)
	setupFoldTransactionDatabase(t, fixture)
	id := ast.NewNodeID()
	reference := treenode.NewTree(fixture.box.ID, "/"+id+".sy", "/Reference", "Reference")
	paragraph := treenode.NewParagraph("")
	paragraph.AppendChild(&ast.Node{Type: ast.NodeTextMark, TextMarkType: "block-ref", TextMarkBlockRefID: fixture.childID,
		TextMarkBlockRefSubtype: "s", TextMarkTextContent: "reference"})
	reference.Root.AppendChild(paragraph)
	if err := indexWriteTreeIndexQueue(reference); err != nil {
		t.Fatal(err)
	}
	sql.FlushQueue()
	if err := PerformTxSync(&Transaction{fromAPI: true, DoOperations: []*Operation{{Action: "move", ID: fixture.childID, ParentID: fixture.targetID}}}); err != nil {
		t.Fatal(err)
	}
	journal, err := os.ReadFile(filepath.Join(util.QueueDir, "index.queue"))
	if err != nil || !bytes.Contains(journal, []byte(`"action":"refresh_def_refs"`)) {
		t.Fatalf("committed move has no durable reference repair: %s, %v", journal, err)
	}
	sql.FlushQueue()
	refs := sql.GetRefsCacheByDefIDInBox(fixture.childID, fixture.box.ID)
	if len(refs) != 1 || refs[0].DefBlockRootID != fixture.targetID || refs[0].DefBlockPath != fixture.targetPath {
		t.Fatalf("committed move left stale reference locations: %+v", refs)
	}
}
