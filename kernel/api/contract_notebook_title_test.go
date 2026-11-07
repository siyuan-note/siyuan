// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"bytes"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/treenode"
)

func testAPIContractNotebookTitle(t *testing.T, boxID string) {
	t.Helper()
	box := model.Conf.Box(boxID)
	tree := treenode.NewTree(boxID, "/"+boxID+".sy", "/Notebook", "Notebook")
	tree.Root.SetIALAttr(model.DocHiddenAttr, "true")
	if _, err := filesys.WriteTree(tree); err != nil {
		t.Fatal(err)
	}
	treenode.UpsertBlockTree(tree)
	engine := gin.New()
	engine.POST("/api/transactions", performTransactions)
	testAPIContractDocumentTitle(t, engine, boxID, boxID)
	if box.GetConf().Name != model.Conf.Language(16) {
		t.Fatal("empty title did not update notebook name")
	}
	for _, route := range []struct {
		path    string
		handler gin.HandlerFunc
	}{
		{"/api/notebook/renameNotebook", renameNotebook},
		{"/api/notebook/setNotebookConf", setNotebookConf},
	} {
		patch := func(name string) []byte {
			return documentPathAPIRequest(t, route.path, route.handler,
				map[string]any{"notebook": boxID, "name": name, "conf": map[string]any{"name": name, "sortMode": 7}})
		}
		if response := patch("Plain notebook"); !bytes.Contains(response, []byte(`"code":0`)) {
			t.Fatalf("plain notebook rename failed: %s", response)
		}
		current, err := model.GetDocTitle(boxID, boxID)
		if err != nil || current.Text != "Plain notebook" || box.GetConf().Name != current.Text {
			t.Fatalf("plain notebook name and title diverged: %+v %v", current, err)
		}
		if err := model.PerformTxSync(&model.Transaction{DoOperations: []*model.Operation{{Action: "setDocTitle", ID: boxID,
			Data: map[string]any{"blockDOM": `<div data-type="NodeParagraph"><div contenteditable="true"><span data-type="strong">Rich notebook</span></div></div>`,
				"expectedRevision": current.Revision}}}}); err != nil {
			t.Fatal(err)
		}
		before := box.GetConf()
		if response := patch("Overwrite"); !bytes.Contains(response, []byte(`"code":-1`)) || box.GetConf().Name != before.Name ||
			box.GetConf().SortMode != before.SortMode {
			t.Fatalf("rejected plain write changed notebook configuration: %s", response)
		}
		if response := patch("Rich notebook"); !bytes.Contains(response, []byte(`"code":0`)) {
			t.Fatalf("echoed notebook name failed: %s", response)
		}
		current, err = model.GetDocTitle(boxID, boxID)
		if err != nil || current.Source == nil || current.Text != "Rich notebook" {
			t.Fatalf("plain name echo lost rich title source: %+v %v", current, err)
		}
		if err := model.PerformTxSync(&model.Transaction{DoOperations: []*model.Operation{{Action: "setDocTitle", ID: boxID,
			Data: map[string]any{"blockDOM": `<div data-type="NodeParagraph"><div contenteditable="true">Plain notebook</div></div>`,
				"expectedRevision": current.Revision}}}}); err != nil {
			t.Fatal(err)
		}
	}
}
