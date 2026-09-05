// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

package model

import (
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
)

func TestUpdateAttributeViewDynamicRefTextsKeepsStaticAnchors(t *testing.T) {
	originalConf := Conf
	Conf = &AppConf{Editor: conf.NewEditor()}
	t.Cleanup(func() { Conf = originalConf })

	const defID = "20260904040000-def0001"
	const refStyle = "color: var(--b3-font-color8);"
	attrView := &av.AttributeView{KeyValues: []*av.KeyValues{{
		Key: &av.Key{ID: "text", Type: av.KeyTypeText},
		Values: []*av.Value{{Type: av.KeyTypeText, Text: &av.ValueText{
			Rich: &av.ValueTextRich{
				Spec: av.ValueTextRichSpec, Format: av.ValueTextRichFormatKramdown,
				Content: `<span data-type="block-ref text" data-id="` + defID +
					`" data-subtype="d" style="` + refStyle + `">Old dynamic</span> and ((` + defID +
					` "Static anchor")) #tag# ` +
					"<<assets/document-20240101000000-abcdefg.pdf/20240101000001-bcdefgh \"annotation\">> " +
					"<span data-type=\"inline-memo\" data-inline-memo-content=\"memo\">annotated</span>",
			},
		}}},
	}}}
	defRoot := &ast.Node{Type: ast.NodeDocument, ID: "20260904040001-root001"}
	defBlock := &ast.Node{Type: ast.NodeParagraph, ID: defID}
	defBlock.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("New dynamic")})
	defRoot.AppendChild(defBlock)

	if !updateAttributeViewDynamicRefTexts(attrView, map[string]*ast.Node{defID: defBlock}) {
		t.Fatal("expected the dynamic attribute view reference anchor to change")
	}
	fragmentTree, err := av.ParseValueTextRich(attrView.KeyValues[0].Values[0].Text.Rich)
	if nil != err {
		t.Fatal(err)
	}
	anchors := map[string]string{}
	marks := map[string]bool{}
	dynamicStyle := ""
	dynamicStyleIAL := false
	ast.Walk(fragmentTree.Root, func(node *ast.Node, entering bool) ast.WalkStatus {
		if !entering {
			return ast.WalkContinue
		}
		if treenode.IsBlockRef(node) {
			_, text, subtype := treenode.GetBlockRef(node)
			anchors[subtype] = text
			if "d" == subtype {
				marks["dynamic-block-ref"] = node.IsTextMarkType("block-ref") && node.IsTextMarkType("text")
				dynamicStyle = node.IALAttr("style")
				dynamicStyleIAL = nil != node.Next && ast.NodeKramdownSpanIAL == node.Next.Type
			}
		}
		for _, typ := range []string{"tag", "file-annotation-ref", "inline-memo"} {
			if node.IsTextMarkType(typ) || "tag" == typ && ast.NodeTag == node.Type ||
				"file-annotation-ref" == typ && ast.NodeFileAnnotationRef == node.Type {
				marks[typ] = true
			}
		}
		return ast.WalkContinue
	})
	if "New dynamic" != anchors["d"] {
		t.Fatalf("unexpected dynamic anchor: %q", anchors["d"])
	}
	if "Static anchor" != anchors["s"] {
		t.Fatalf("static anchor changed: %q", anchors["s"])
	}
	if !marks["dynamic-block-ref"] || refStyle != dynamicStyle || !dynamicStyleIAL {
		t.Fatalf("dynamic reference style was not preserved: types=%v, style=%q, IAL=%v",
			marks["dynamic-block-ref"], dynamicStyle, dynamicStyleIAL)
	}
	for _, typ := range []string{"tag", "file-annotation-ref", "inline-memo"} {
		if !marks[typ] {
			t.Fatalf("dynamic anchor refresh removed %s markup", typ)
		}
	}
	rich := attrView.KeyValues[0].Values[0].Text.Rich
	if _, err = av.NormalizeValueTextRich(rich); nil != err {
		t.Fatal(err)
	}
	normalized := rich.Content
	if _, err = av.NormalizeValueTextRich(rich); nil != err || normalized != rich.Content {
		t.Fatalf("updated styled dynamic reference is not stable, before=%q, after=%q, err=%v",
			normalized, rich.Content, err)
	}
}

func TestUpdateAttributeViewDynamicRefTextsIgnoresLegacyPlainText(t *testing.T) {
	const (
		defID   = "20260904041000-def0001"
		literal = "((20260904041000-def0001 'Literal plain text'))"
	)
	attrView := &av.AttributeView{KeyValues: []*av.KeyValues{{
		Key:    &av.Key{ID: "text", Type: av.KeyTypeText},
		Values: []*av.Value{{Type: av.KeyTypeText, Text: &av.ValueText{Content: literal}}},
	}}}
	defBlock := &ast.Node{Type: ast.NodeParagraph, ID: defID}
	defBlock.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("Updated")})

	if updateAttributeViewDynamicRefTexts(attrView, map[string]*ast.Node{defID: defBlock}) {
		t.Fatal("legacy plain text was treated as rich text")
	}
	if literal != attrView.KeyValues[0].Values[0].Text.Content {
		t.Fatalf("legacy plain text changed: %q", attrView.KeyValues[0].Values[0].Text.Content)
	}
}

func TestAttributeViewRefSourcesResolveCarrierAndDeduplicateMirrors(t *testing.T) {
	const (
		boxID         = "20260904042000-box0001"
		rootID        = "20260904042001-root001"
		attributeView = "20260904042002-av00001"
		firstBlockID  = "20260904042003-db00001"
		secondBlockID = "20260904042004-db00002"
	)
	setupExportRelatedTest(t, boxID)
	setupAttributeViewRefI18n(t)
	if err := av.SaveAttributeView(av.NewAttributeView(attributeView)); nil != err {
		t.Fatal(err)
	}
	tree := newAttributeViewRefCarrierTestTree(boxID, rootID, attributeView, firstBlockID, secondBlockID)
	writeExportRelatedTestTree(t, tree)

	refs := []*sql.Ref{
		{Type: sql.AttributeViewRefType, BlockID: firstBlockID, RootID: rootID, Box: boxID, Path: tree.Path},
		{Type: sql.AttributeViewRefType, BlockID: secondBlockID, RootID: rootID, Box: boxID, Path: tree.Path},
		{Type: sql.AttributeViewRefType, BlockID: firstBlockID, RootID: rootID, Box: boxID, Path: "/stale.sy"},
		{Type: "textmark", BlockID: firstBlockID, RootID: rootID, Box: boxID, Path: tree.Path},
	}
	sources := attributeViewRefSources(refs)
	if 1 != len(sources) || attributeView != sources[0].avID || "" != sources[0].boxID {
		t.Fatalf("unexpected attribute view reference sources: %+v", sources)
	}
}
