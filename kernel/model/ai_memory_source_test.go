// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/av"
)

func TestAIMemoryNativeEvidenceSerializesLiveSubtree(t *testing.T) {
	setupAIMemoryTest(t)
	root := &ast.Node{Type: ast.NodeDocument, ID: "20261029000000-abcdefg"}
	paragraph := &ast.Node{Type: ast.NodeParagraph, ID: "20261029000001-abcdefg"}
	paragraph.SetIALAttr("custom-project", "memory test")
	text := &ast.Node{Type: ast.NodeText, Tokens: []byte("Plan, not completed")}
	strong := &ast.Node{Type: ast.NodeStrong}
	strong.AppendChild(text)
	paragraph.AppendChild(strong)
	paragraph.AppendChild(&ast.Node{Type: ast.NodeTextMark, TextMarkType: "a", TextMarkAHref: "https://example.com/source", TextMarkTextContent: "source link"})
	paragraph.AppendChild(&ast.Node{Type: ast.NodeTextMark, TextMarkType: "block-ref", TextMarkBlockRefID: "20261029000002-abcdefg", TextMarkBlockRefSubtype: "s", TextMarkTextContent: "reference"})
	root.AppendChild(paragraph)
	outside := &ast.Node{Type: ast.NodeParagraph, ID: "20261029000003-abcdefg"}
	outside.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("OUTSIDE_SUBTREE")})
	root.AppendChild(outside)
	tree := &parse.Tree{Root: root, Box: "20261029000004-abcdefg"}
	before, err := memoryNativeEvidence(tree, paragraph)
	if err != nil {
		t.Fatal(err)
	}
	for _, fragment := range []string{"Plan, not completed", "NodeParagraph", "NodeStrong", "NodeText", "Children", "custom-project", "memory test", "https://example.com/source", "TextMarkBlockRefID", "20261029000002-abcdefg"} {
		if !bytes.Contains(before, []byte(fragment)) {
			t.Fatalf("missing native evidence %q: %s", fragment, before)
		}
	}
	if bytes.Contains(before, []byte("OUTSIDE_SUBTREE")) {
		t.Fatal("serialized parent or sibling outside selected subtree")
	}
	again, err := memoryNativeEvidence(tree, paragraph)
	if err != nil || !bytes.Equal(before, again) {
		t.Fatalf("unstable native evidence: %v", err)
	}
	if paragraph.Parent != root || paragraph.Next != outside || text.Data != "" || text.TypeStr != "" || paragraph.Properties != nil {
		t.Fatal("native serialization mutated original tree")
	}
	text.Tokens = []byte("Actually completed")
	after, err := memoryNativeEvidence(tree, paragraph)
	if err != nil || memoryHash(before) == memoryHash(after) || !bytes.Contains(after, []byte("Actually completed")) {
		t.Fatalf("live text change did not change source revision: %v", err)
	}
	whole, err := memoryNativeEvidence(tree, root)
	if err != nil || !bytes.Contains(whole, []byte("OUTSIDE_SUBTREE")) || !bytes.Contains(whole, []byte("Actually completed")) {
		t.Fatalf("whole document lost descendant evidence: %v", err)
	}
}

func TestAIMemoryNativeEvidenceOnlySourceRows(t *testing.T) {
	database := &av.AttributeView{ID: "database", Name: "project", KeyValues: []*av.KeyValues{
		{Key: &av.Key{ID: "title", Name: "Title", Type: av.KeyTypeBlock}, Values: []*av.Value{
			{Type: av.KeyTypeBlock, BlockID: "row1", Block: &av.ValueBlock{ID: "source", Content: "allowed"}},
			{Type: av.KeyTypeBlock, BlockID: "row2", Block: &av.ValueBlock{ID: "other-box", Content: "SECRET"}},
		}},
		{Key: &av.Key{ID: "amount", Name: "Amount", Type: av.KeyTypeNumber}, Values: []*av.Value{
			{Type: av.KeyTypeNumber, BlockID: "row1", Number: &av.ValueNumber{Content: 42}},
			{Type: av.KeyTypeNumber, BlockID: "row2", Number: &av.ValueNumber{Content: 999}},
		}},
		{Key: &av.Key{ID: "relation", Name: "Relation", Type: av.KeyTypeRelation}, Values: []*av.Value{
			{Type: av.KeyTypeRelation, BlockID: "row1", RenderedContent: "SECRET"},
		}},
	}}
	evidence, err := memoryDatabaseEvidence(database, map[string]bool{"source": true})
	if err != nil {
		t.Fatal(err)
	}
	if len(evidence.Rows) != 1 || len(evidence.Rows[0].Fields) != 3 {
		t.Fatalf("unexpected rows: %+v", evidence.Rows)
	}
	if evidence.Rows[0].Fields[1].Value.Number.Content != 42 {
		t.Fatal("typed number was lost")
	}
	if !evidence.Rows[0].Fields[2].Excluded {
		t.Fatal("related content not marked excluded")
	}
	data, _ := json.Marshal(evidence)
	if strings.Contains(string(data), "SECRET") || strings.Contains(string(data), "999") {
		t.Fatalf("other source leaked: %s", data)
	}
	if !evidence.OtherRowsExcluded {
		t.Fatal("partial source not disclosed")
	}
}
func TestAIMemoryNativeEvidenceRejectsMalformedAndBudget(t *testing.T) {
	for _, database := range []*av.AttributeView{
		{KeyValues: []*av.KeyValues{nil}},
		{KeyValues: []*av.KeyValues{{Key: &av.Key{Type: av.KeyTypeBlock}, Values: []*av.Value{{Type: av.KeyTypeBlock}}}}},
		{KeyValues: make([]*av.KeyValues, 129)},
	} {
		if _, err := memoryDatabaseEvidence(database, map[string]bool{"source": true}); err == nil {
			t.Fatal("invalid or incomplete data accepted")
		}
	}
}
func TestAIMemoryNativeValueExcludesUnrelatedPayload(t *testing.T) {
	value := &av.Value{Type: av.KeyTypeText, Text: &av.ValueText{Content: "allowed"}, Block: &av.ValueBlock{Content: "SECRET"}, RenderedContent: "SECRET"}
	encoded, _ := json.Marshal(memoryNativeValue(value))
	if strings.Contains(string(encoded), "SECRET") {
		t.Fatalf("unexpected payload leaked: %s", encoded)
	}
}
