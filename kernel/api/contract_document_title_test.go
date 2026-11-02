// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"encoding/json"
	"html"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/render"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/treenode"
)

func testAPIContractDocumentTitle(t *testing.T, engine *gin.Engine, boxID, docID string) {
	t.Helper()
	engine.POST("/api/block/getDocTitle", getDocTitle)
	post := func(route string, payload any) []byte {
		t.Helper()
		body, err := json.Marshal(payload)
		if err != nil {
			t.Fatal(err)
		}
		recorder := httptest.NewRecorder()
		request := httptest.NewRequest("POST", route, strings.NewReader(string(body)))
		request.Header.Set("Content-Type", "application/json")
		engine.ServeHTTP(recorder, request)
		requireAPIContract(t, "POST", route, recorder)
		return recorder.Body.Bytes()
	}
	read := func() apicontract.DocumentTitleData {
		t.Helper()
		body := post("/api/block/getDocTitle", apicontract.DocumentTitleRequest{ID: docID, Notebook: boxID})
		var response struct {
			Code int
			Data apicontract.DocumentTitleData
		}
		if err := json.Unmarshal(body, &response); err != nil || response.Code != 0 {
			t.Fatalf("title read failed: %s, %v", body, err)
		}
		return response.Data
	}
	initial := read()
	if initial.Source != nil || initial.Format != "plain" || initial.Revision == "" {
		t.Fatal("plain title contract lost its representation")
	}
	paragraph := &ast.Node{Type: ast.NodeParagraph}
	paragraph.AppendChild(&ast.Node{Type: ast.NodeTextMark, TextMarkType: "strong a", TextMarkTextContent: "Contract title", TextMarkAHref: "https://example.com/"})
	source, err := render.NewDocumentTitle(paragraph)
	if err != nil {
		t.Fatal(err)
	}
	operation := map[string]any{"action": "setDocTitle", "id": docID,
		"data": map[string]any{"source": source, "expectedRevision": initial.Revision}}
	payload := map[string]any{"app": "contract", "session": "contract", "reqId": 124,
		"transactions": []map[string]any{{"doOperations": []map[string]any{operation}}}}
	var saved struct {
		Code int
		Data []struct{ DoOperations []struct{ RetData string } }
	}
	body := post("/api/transactions", payload)
	if err := json.Unmarshal(body, &saved); err != nil || saved.Code != 0 || len(saved.Data) != 1 || len(saved.Data[0].DoOperations) != 1 {
		t.Fatalf("title write contract failed: %s, %v", body, err)
	}
	current := read()
	if current.Source == nil || current.Source.Content != source.Content || current.Format != "inline-ast" ||
		current.Revision != saved.Data[0].DoOperations[0].RetData || current.Text != "Contract title" ||
		!strings.Contains(current.BlockDOM, `data-document-title="true"`) {
		t.Fatal("saved source, projection and transaction revision disagree")
	}
	var conflict struct {
		Code int
		Data json.RawMessage
	}
	body = post("/api/transactions", payload)
	if err := json.Unmarshal(body, &conflict); err != nil || conflict.Code != -409 || string(conflict.Data) != "null" {
		t.Fatalf("conflict is not actionable: %s, %v", body, err)
	}
	operation["data"] = map[string]any{"source": source, "blockDOM": current.BlockDOM, "expectedRevision": current.Revision}
	body = post("/api/transactions", payload)
	if err := json.Unmarshal(body, &conflict); err != nil || conflict.Code == 0 {
		t.Fatal("ambiguous source accepted")
	}
	if read().Revision != current.Revision {
		t.Fatal("rejected write changed title")
	}
	tree, err := model.LoadTreeByBlockID(docID)
	if err != nil || treenode.DocumentTitleRevision(tree.Root) != current.Revision {
		t.Fatal("response preceded source commit")
	}
	for _, text := range []string{"**literal** A/B", "中文 😄 & <literal>", ""} {
		operation["data"] = map[string]any{"expectedRevision": current.Revision,
			"blockDOM": `<div data-type="NodeParagraph"><div contenteditable="true">` + html.EscapeString(text) + `</div></div>`}
		body = post("/api/transactions", payload)
		if err := json.Unmarshal(body, &saved); err != nil || saved.Code != 0 {
			t.Fatalf("plain title write failed: %s %v", body, err)
		}
		current = read()
		if current.Source != nil || current.Format != "plain" || current.Text != text || current.Empty != (text == "") {
			t.Fatalf("plain title contract created an inline source: %+v", current)
		}
	}
}
