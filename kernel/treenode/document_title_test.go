// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package treenode

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/88250/lute/render"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func richTitleTestParagraph() *ast.Node {
	paragraph := &ast.Node{Type: ast.NodeParagraph}
	paragraph.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("A/B ")})
	paragraph.AppendChild(&ast.Node{Type: ast.NodeTextMark, TextMarkType: "strong em", TextMarkTextContent: "bold"})
	paragraph.AppendChild(&ast.Node{Type: ast.NodeTextMark, TextMarkType: "block-ref", TextMarkBlockRefID: "20261025000000-target1",
		TextMarkBlockRefSubtype: "d", TextMarkTextContent: "target"})
	paragraph.AppendChild(&ast.Node{Type: ast.NodeTextMark, TextMarkType: "inline-math", TextMarkInlineMathContent: "x+y"})
	paragraph.AppendChild(&ast.Node{Type: ast.NodeTextMark, TextMarkType: "inline-memo", TextMarkTextContent: "note", TextMarkInlineMemoContent: "private memo"})
	return paragraph
}

func TestDocumentTitleSourceRoundTripAndWalker(t *testing.T) {
	tree := NewTree("20261025000000-box0001", "/20261025000000-title01.sy", "/Original", "Original")
	body := tree.Root.FirstChild
	if err := SetDocumentTitleParagraph(tree.Root, richTitleTestParagraph()); err != nil {
		t.Fatal(err)
	}
	UpgradeSpec(tree)
	if tree.Root.Spec != RichDocumentTitleSpec || ReadDocumentTitle(tree.Root).Text != "A/B boldtargetx+ynote" {
		t.Fatalf("source summary or spec: %+v", ReadDocumentTitle(tree.Root))
	}
	luteEngine := util.NewLute()
	data := render.NewJSONRenderer(tree, luteEngine.RenderOptions, luteEngine.ParseOptions).Render()
	for _, withoutFix := range []bool{false, true} {
		var restored *parse.Tree
		var err error
		if withoutFix {
			restored, err = ParseJSONWithoutFix(data, luteEngine.ParseOptions)
		} else {
			restored, _, err = ParseJSON(data, luteEngine.ParseOptions)
		}
		if err != nil || restored.Root.DocumentTitle == nil || restored.Root.DocumentTitle.Content != tree.Root.DocumentTitle.Content {
			t.Fatalf("source lost in document parse: %v", err)
		}
	}
	original := tree.Root.DocumentTitle.Content
	refs := 0
	WalkWithInlineTitles(tree.Root, func(node *ast.Node, entering bool) ast.WalkStatus {
		if entering && IsBlockRef(node) {
			refs++
			if ParentBlock(node) != tree.Root {
				t.Fatal("title references must belong to document root")
			}
		}
		return ast.WalkContinue
	})
	if refs != 1 || original != tree.Root.DocumentTitle.Content || tree.Root.FirstChild != body {
		t.Fatal("read traversal changed source or body")
	}
	revision := DocumentTitleRevision(tree.Root)
	WalkWithInlineTitles(tree.Root, func(node *ast.Node, entering bool) ast.WalkStatus {
		if entering && IsBlockRef(node) {
			node.TextMarkTextContent = "updated"
		}
		return ast.WalkContinue
	})
	if revision != DocumentTitleRevision(tree.Root) || !strings.Contains(ReadDocumentTitle(tree.Root).Text, "updated") {
		t.Fatal("dynamic cache must change projection without invalidating source revision")
	}
	finish := MaterializeInlineTitles(tree.Root)
	finishNested := MaterializeInlineTitles(tree.Root)
	ast.Walk(tree.Root, func(node *ast.Node, entering bool) ast.WalkStatus {
		if entering && IsBlockRef(node) {
			node.TextMarkBlockRefID = "20261025000000-target2"
		}
		return ast.WalkContinue
	})
	finishNested()
	finish()
	finish()
	if tree.Root.FirstChild != body || revision == DocumentTitleRevision(tree.Root) || !strings.Contains(tree.Root.DocumentTitle.Content, "target2") {
		t.Fatal("materialized rewrite lost source or added a body block")
	}
}

func TestDocumentTitleRejectsUnknownSourceBeforeRepair(t *testing.T) {
	for _, source := range []string{
		`null`, `{"spec":1,"format":"future","content":"secret"}`,
		`{"spec":2,"spec":1,"format":"inline-ast","content":"[]"}`,
		`{"spec":1,"format":"inline-ast","content":"[]","extra":true}`,
		`{"spec":1,"format":"inline-ast","content":"[{\"Type\":\"NodeParagraph\"}]"}`,
	} {
		data := []byte(`{"Type":"NodeDocument","Spec":"7","Properties":{"title":"fallback"},"DocumentTitle":` + source + `}`)
		if err := CheckSpecJSON(data); err == nil || strings.Contains(err.Error(), "secret") {
			t.Fatalf("invalid source accepted or exposed: %s, %v", source, err)
		}
	}
	valid := `{"spec":1,"format":"inline-ast","content":"[]"}`
	for _, data := range []string{
		`{"Type":"NodeDocument","Spec":"6","DocumentTitle":` + valid + `}`,
		`{"Type":"NodeDocument","Spec":"7","DocumentTitle":` + valid + `,"DocumentTitle":` + valid + `}`,
		`{"Type":"NodeDocument","Spec":"7","Children":[{"Type":"NodeParagraph","DocumentTitle":` + valid + `}]}`,
	} {
		if err := CheckSpecJSON([]byte(data)); err == nil {
			t.Fatal("invalid source version or owner accepted")
		}
	}
}

func TestDocumentTitleLegacyLiteralAndEmptySource(t *testing.T) {
	tree := NewTree("20261025000000-box0001", "/20261025000000-title01.sy", "/Literal", "**literal** A/B &amp;")
	paragraph, err := DocumentTitleParagraph(tree.Root)
	if err != nil || paragraph.FirstChild.Type != ast.NodeText || paragraph.FirstChild.Next != nil || paragraph.Text() != "**literal** A/B &amp;" {
		t.Fatalf("legacy title reinterpreted: %v", err)
	}
	if err = SetDocumentTitleParagraph(tree.Root, &ast.Node{Type: ast.NodeParagraph}); err != nil {
		t.Fatal(err)
	}
	if title := ReadDocumentTitle(tree.Root); !title.Empty || title.Text != "" || title.Format != "plain" || tree.Root.DocumentTitle != nil {
		t.Fatalf("empty source acquired placeholder: %+v", title)
	}
	if data, _ := json.Marshal(tree.Root.DocumentTitle); strings.Contains(string(data), "Untitled") {
		t.Fatal("placeholder persisted")
	}
}

func TestDocumentTitlePlainWritesPreserveRichReadersAndDocumentIdentity(t *testing.T) {
	tree := NewTree("20261025000000-box0001", "/20261025000000-title01.sy", "/Title", "Title")
	body := tree.Root.FirstChild
	for _, value := range []string{"", "A/B", "**literal** <tag> &amp; ", "日本語 中文 😄"} {
		paragraph := &ast.Node{Type: ast.NodeParagraph}
		paragraph.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte(value)})
		if err := SetDocumentTitleParagraph(tree.Root, paragraph); err != nil {
			t.Fatal(err)
		}
		if tree.Root.DocumentTitle != nil || ReadDocumentTitle(tree.Root).Format != "plain" || tree.Root.IALAttr("title") != value {
			t.Fatalf("plain source unnecessarily promoted: %q", value)
		}
		restored, err := DocumentTitleParagraph(tree.Root)
		if err != nil || DocumentTitleText(restored) != value || tree.Root.FirstChild != body {
			t.Fatalf("plain round trip changed content or body: %v", err)
		}
	}
	if err := SetDocumentTitleParagraph(tree.Root, richTitleTestParagraph()); err != nil {
		t.Fatal(err)
	}
	UpgradeSpec(tree)
	if tree.Root.DocumentTitle == nil {
		t.Fatal("rich content lost its authoritative source")
	}
	paragraph := &ast.Node{Type: ast.NodeParagraph}
	paragraph.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("Plain again")})
	if err := SetDocumentTitleParagraph(tree.Root, paragraph); err != nil {
		t.Fatal(err)
	}
	UpgradeSpec(tree)
	if tree.Root.DocumentTitle != nil || tree.Root.Spec != RichDocumentTitleSpec || tree.Root.FirstChild != body {
		t.Fatal("removing rich styling must retain the document specification and body")
	}
	// 已保存的旧纯文字行级源仍可认证读取，读取本身不触发折叠或迁移。
	source, err := render.NewDocumentTitle(paragraph)
	if err != nil {
		t.Fatal(err)
	}
	tree.Root.DocumentTitle = source
	data := render.NewJSONRenderer(tree, util.NewLute().RenderOptions, util.NewLute().ParseOptions).Render()
	restored, _, err := ParseJSON(data, util.NewLute().ParseOptions)
	if err != nil || restored.Root.DocumentTitle == nil || restored.Root.DocumentTitle.Content != source.Content {
		t.Fatalf("existing inline source reader changed: %v", err)
	}
}

func TestDocumentTitleMetadataTracksStyleOnlyChanges(t *testing.T) {
	for _, encrypted := range []bool{false, true} {
		t.Run(map[bool]string{false: "plain", true: "encrypted"}[encrypted], func(t *testing.T) {
			boxID := withDocumentMetadataDB(t, encrypted)
			tree := NewTree(boxID, "/20261025000000-title01.sy", "/styled", "styled")
			paragraph := &ast.Node{Type: ast.NodeParagraph}
			mark := &ast.Node{Type: ast.NodeTextMark, TextMarkType: "strong", TextMarkTextContent: "styled"}
			paragraph.AppendChild(mark)
			if err := SetDocumentTitleParagraph(tree.Root, paragraph); err != nil {
				t.Fatal(err)
			}
			UpgradeSpec(tree)
			UpsertBlockTree(tree)
			before, err := GetDocumentMetadata(boxID, tree.ID)
			if err != nil {
				t.Fatal(err)
			}
			mark.TextMarkType = "em"
			if err = SetDocumentTitleParagraph(tree.Root, paragraph); err != nil {
				t.Fatal(err)
			}
			UpsertBlockTree(tree)
			after, err := GetDocumentMetadata(boxID, tree.ID)
			if err != nil || before.Title.Text != after.Title.Text || before.Revision == after.Revision || before.SourceRevision == after.SourceRevision {
				t.Fatalf("style-only metadata change lost: %v", err)
			}
		})
	}
}

func TestDocumentTitleSummaryIgnoresCaretPlaceholdersWithoutChangingSource(t *testing.T) {
	paragraph := &ast.Node{Type: ast.NodeParagraph}
	paragraph.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("Start \u200b")})
	paragraph.AppendChild(&ast.Node{Type: ast.NodeTextMark, TextMarkType: "kbd", TextMarkTextContent: "Ctrl"})
	paragraph.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("\u200b / \u200b")})
	paragraph.AppendChild(&ast.Node{Type: ast.NodeTextMark, TextMarkType: "code", TextMarkTextContent: "Code"})
	paragraph.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("\u200b / \u200b")})
	paragraph.AppendChild(&ast.Node{Type: ast.NodeTextMark, TextMarkType: "tag", TextMarkTextContent: "Tag"})
	paragraph.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("\u200b word\u2060joiner")})
	paragraph.AppendChild(&ast.Node{Type: ast.NodeTextMark, TextMarkType: "a", TextMarkTextContent: "Link",
		TextMarkAHref: "assets/file\u200bname.txt"})
	before, err := render.NewDocumentTitle(paragraph)
	if err != nil {
		t.Fatal(err)
	}
	if got := DocumentTitleText(paragraph); got != "Start Ctrl / Code / Tag word\u2060joinerLink" {
		t.Fatalf("caret placeholders entered the visible summary: %q", got)
	}
	after, err := render.NewDocumentTitle(paragraph)
	if err != nil || before.Content != after.Content || !strings.Contains(after.Content, "file\u200bname.txt") {
		t.Fatalf("summary extraction changed the source or resource address: %v", err)
	}
}
