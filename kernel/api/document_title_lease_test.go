// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build (sqlcipher || libsqlcipher) && cgo

package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/render"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestContractDocTitleUndoNotebookResponseLease(t *testing.T) {
	runNotebookResponseLease(t, false, false)
}

func TestContractDocTitleRedoNotebookResponseLease(t *testing.T) {
	runNotebookResponseLease(t, false, false)
}

func prepareDocumentTitleReplayLease(t *testing.T, engine *gin.Engine, boxID string, redo bool) string {
	t.Helper()
	tree, err := filesys.LoadTree(boxID, "/"+boxID+".sy", util.NewLute())
	if err != nil {
		t.Fatal(err)
	}
	id := ast.NewNodeID()
	tree.ID, tree.Root.ID, tree.Path, tree.HPath = id, id, "/"+id+".sy", "/Before"
	tree.Root.SetIALAttr("id", id)
	tree.Root.SetIALAttr("title", "Before")
	if _, err = filesys.WriteTree(tree); err != nil {
		t.Fatal(err)
	}
	treenode.UpsertBlockTree(tree)
	sql.UpsertTreeQueue(tree)
	sql.FlushQueue()
	title, err := model.GetDocTitle(id, boxID)
	if err != nil {
		t.Fatal(err)
	}
	data := map[string]any{"expectedRevision": title.Revision}
	if redo {
		paragraph := &ast.Node{Type: ast.NodeParagraph}
		paragraph.AppendChild(&ast.Node{Type: ast.NodeTextMark, TextMarkType: "strong", TextMarkTextContent: "REVIEW-SECRET-TITLE"})
		source, err := render.NewDocumentTitle(paragraph)
		if err != nil {
			t.Fatal(err)
		}
		data["source"] = source
	} else {
		data["blockDOM"] = `<div data-type="NodeParagraph"><div contenteditable="true"><span data-type="strong">REVIEW-SECRET-TITLE</span></div></div>`
	}
	tx := &model.Transaction{DoOperations: []*model.Operation{{Action: "setDocTitle", ID: id, Data: data}}}
	tx.MarkFromAPI()
	if err = model.PerformTxSync(tx); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { model.GlobalUndoLog.Clear(id) })
	sql.FlushQueue()
	if redo {
		body, err := json.Marshal(map[string]any{"rootID": id, "app": "lease-test", "session": "lease-test"})
		if err != nil {
			t.Fatal(err)
		}
		recorder := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodPost, "/api/transactions/undo", strings.NewReader(string(body)))
		request.Header.Set("Content-Type", "application/json")
		engine.ServeHTTP(recorder, request)
		requireAPIContract(t, http.MethodPost, "/api/transactions/undo", recorder)
		requireDocumentTitleReplayResponse(t, recorder.Body.Bytes())
	}
	return id
}

func requireDocumentTitleReplayResponse(t *testing.T, body []byte) {
	t.Helper()
	var response struct {
		Code int
		Data struct {
			Failed       bool
			DoOperations []struct{ Action string }
		}
	}
	if err := json.Unmarshal(body, &response); err != nil || response.Code != 0 || response.Data.Failed ||
		len(response.Data.DoOperations) != 1 || response.Data.DoOperations[0].Action != "setDocTitle" ||
		!strings.Contains(string(body), "REVIEW-SECRET-TITLE") {
		t.Fatalf("title replay did not return its original request source: %s, %v", body, err)
	}
}
