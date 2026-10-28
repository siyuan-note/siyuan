// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5

package model

import (
	"testing"

	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestImportNotebookDocumentTargets(t *testing.T) {
	testImportNotebookDocumentTargets(t, "Anchor")
}

func TestStructuredTitlesNativeImport(t *testing.T) {
	testImportNotebookDocumentTargets(t, "Anchor/../literal")
}

func testImportNotebookDocumentTargets(t *testing.T, title string) {
	t.Helper()
	const sourceBoxID, targetBoxID = "20261023092000-source1", "20261023092001-target1"
	const docID = "20261023092002-documen"
	setupExportRelatedTest(t, sourceBoxID, targetBoxID)
	setupNotebookDocumentImportDatabase(t)
	source := &Box{ID: sourceBoxID}
	sourceConf := source.GetConf()
	sourceConf.DocCreateTarget = &conf.DocumentTarget{Version: 2, Notebook: sourceBoxID,
		Anchor: conf.DocumentTargetAnchor{Kind: "document", ID: docID}, Parents: []string{}, Title: "Literal template", OnMissingParent: "error"}
	sourceConf.RefCreateTarget, sourceConf.DailyNoteTarget = sourceConf.DocCreateTarget, sourceConf.DocCreateTarget
	if err := source.SaveConf(sourceConf); err != nil {
		t.Fatal(err)
	}
	tree := treenode.NewTree(sourceBoxID, "/"+docID+".sy", "/"+title, title)
	treenode.UpgradeSpec(tree)
	writeExportRelatedTestTree(t, tree)
	if err := writeBoxDocID(sourceBoxID); err != nil {
		t.Fatal(err)
	}
	archive, err := exportedFilePath(ExportNotebookSY(sourceBoxID))
	if err != nil {
		t.Fatal(err)
	}
	ids := map[string]string{}
	if _, err = importSY0(archive, targetBoxID, "/", true, false, ids, true); err != nil {
		t.Fatal(err)
	}
	imported := (&Box{ID: targetBoxID}).GetConf()
	loaded, err := filesys.LoadTree(targetBoxID, "/"+ids[docID]+".sy", util.NewLute())
	if err != nil || treenode.ReadDocumentTitle(loaded.Root).Text != title || loaded.Root.Spec != tree.Root.Spec {
		t.Fatal("native import changed the title or source specification", err)
	}
	for _, target := range []*conf.DocumentTarget{imported.DocCreateTarget, imported.RefCreateTarget, imported.DailyNoteTarget} {
		if target == nil || target.Notebook != targetBoxID || target.Anchor.ID != ids[docID] || target.Anchor.ID == docID ||
			target.Title != "Literal template" {
			t.Fatal("native notebook import left stale configured identities", target, ids)
		}
	}
	if target := source.GetConf().DocCreateTarget; target.Notebook != sourceBoxID || target.Anchor.ID != docID {
		t.Fatal("native import changed the source notebook")
	}
}
