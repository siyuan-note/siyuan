// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/render"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func primaryRichTestDOM(content string) string {
	return `<div data-type="NodeParagraph" data-node-id="20000101000000-primary"><div contenteditable="true">` + content + `</div></div>`
}

func TestPrimaryRichEditingRejectsLegacyProjectionAndInvalidBlocks(t *testing.T) {
	value := &av.Value{Type: av.KeyTypeBlock, IsDetached: true, Block: &av.ValueBlock{Content: "**literal**"}}
	data, _ := json.Marshal(map[string]any{"block": map[string]any{"richBlockDOM": primaryRichTestDOM(`<span data-type="strong">rich</span>`)}})
	if err := prepareAttributeViewPrimaryRich(nil, value, nil, data, ""); err != nil {
		t.Fatal(err)
	}
	if value.Block.Content != "rich" || value.Block.Rich == nil {
		t.Fatal("missing source", value.Block)
	}
	before := value.Clone()
	canonical, _ := json.Marshal(map[string]any{"block": map[string]any{"rich": value.Block.Rich, "richBlockDOM": value.Block.RichBlockDOM}})
	if err := prepareAttributeViewPrimaryRich(nil, value.Clone(), before, canonical, ""); err != nil {
		t.Fatal("canonical response cannot be submitted", err)
	}
	mismatch, _ := json.Marshal(map[string]any{"block": map[string]any{"rich": value.Block.Rich, "richBlockDOM": primaryRichTestDOM("different")}})
	if err := prepareAttributeViewPrimaryRich(nil, value.Clone(), before, mismatch, ""); err == nil {
		t.Fatal("inconsistent source and DOM accepted")
	}
	updated := value.Clone()
	updated.Block.Content = "replacement"
	if err := prepareAttributeViewPrimaryRich(nil, updated, before, []byte(`{"block":{"content":"replacement"}}`), ""); err == nil {
		t.Fatal("legacy summary overwrote source")
	}
	if !reflect.DeepEqual(value.Block.Rich, before.Block.Rich) {
		t.Fatal("source mutated after rejection")
	}
	updated = value.Clone()
	invalid, _ := json.Marshal(map[string]any{"block": map[string]any{"richBlockDOM": primaryRichTestDOM("first") + primaryRichTestDOM("second")}})
	if err := prepareAttributeViewPrimaryRich(nil, updated, before, invalid, ""); err == nil {
		t.Fatal("multiple paragraphs accepted")
	}
	updated = value.Clone()
	updated.Block.Rich = nil
	updated.Block.Content = "replacement"
	if err := prepareAttributeViewPrimaryRich(nil, updated, before, []byte(`{"block":{"content":"replacement","rich": null ,"richBlockDOM":null}}`), ""); err != nil || updated.Block.Rich != nil {
		t.Fatal("explicit plain replacement failed", err)
	}
}

func TestPrimaryRichCellUpdatePreservesIdentityAndRejectedSource(t *testing.T) {
	value := &av.Value{ID: "20261110000000-value00", KeyID: "20261110000000-key0000", BlockID: "20261110000000-row0000",
		Type: av.KeyTypeBlock, IsDetached: true, Block: &av.ValueBlock{Content: "original", Icon: "1f600"}}
	database := &av.AttributeView{ID: "20261110000000-av00000", KeyValues: []*av.KeyValues{{
		Key: &av.Key{ID: value.KeyID, Type: av.KeyTypeBlock}, Values: []*av.Value{value},
	}}}
	updated, err := updateAttributeViewValue(nil, database, value.KeyID, value.BlockID, map[string]any{
		"id": "other", "blockID": "other", "block": map[string]any{"richBlockDOM": primaryRichTestDOM(`<span data-type="strong">rich</span>`)},
	}, false)
	if err != nil || updated != value || value.ID != "20261110000000-value00" || value.BlockID != "20261110000000-row0000" ||
		value.Block.Rich == nil || value.Block.Content != "rich" || value.Block.Icon != "1f600" || !value.IsDetached {
		t.Fatal("rich update changed row identity or lost content", updated, err)
	}
	before, _ := json.Marshal(value)
	for _, block := range []map[string]any{
		{"content": "lossy replacement"},
		{"richBlockDOM": primaryRichTestDOM("one") + primaryRichTestDOM("two")},
		{"rich": map[string]any{"spec": 99, "format": "inline-ast", "content": "[]"}},
	} {
		if _, err = updateAttributeViewValue(nil, database, value.KeyID, value.BlockID, map[string]any{"block": block}, false); err == nil {
			t.Fatal("invalid update accepted", block)
		}
		after, _ := json.Marshal(value)
		if string(before) != string(after) {
			t.Fatal("rejected update mutated the stored value")
		}
	}
	if _, err = updateAttributeViewValue(nil, database, value.KeyID, value.BlockID,
		map[string]any{"block": map[string]any{"icon": "1f680"}}, false); err != nil || value.Block.Rich == nil || value.Block.Content != "rich" {
		t.Fatal("partial icon update lost source", err)
	}
	if _, err = updateAttributeViewValue(nil, database, value.KeyID, value.BlockID,
		map[string]any{"block": map[string]any{"content": "**literal**", "rich": nil}}, false); err != nil ||
		value.Block.Rich != nil || value.Block.Content != "**literal**" || value.Block.RichBlockDOM != "" {
		t.Fatal("explicit plain replacement failed", err)
	}
}

func TestPrimaryRichCanonicalResponseCanBeRestoredForTitleInlineElements(t *testing.T) {
	for _, html := range []string{
		`<span data-type="strong em">Styled</span><span data-type="code">code</span>`,
		`<span data-type="inline-math" data-subtype="math" data-content="x^2"></span>`,
		`<span class="img"><span><img src="assets/a.png" alt="image"></span></span>`,
		`<span data-type="a" data-href="assets/a.pdf">file</span>`,
		`<span data-type="block-ref" data-id="20261110000000-target0" data-subtype="d">Target</span>`,
	} {
		value := &av.Value{Type: av.KeyTypeBlock, IsDetached: true, Block: &av.ValueBlock{}}
		data, _ := json.Marshal(map[string]any{"block": map[string]any{"richBlockDOM": primaryRichTestDOM(html)}})
		if err := prepareAttributeViewPrimaryRich(nil, value, nil, data, ""); err != nil {
			t.Fatal(html, err)
		}
		canonical, _ := json.Marshal(value)
		if err := prepareAttributeViewPrimaryRich(nil, value.Clone(), value, canonical, ""); err != nil {
			t.Fatal("canonical source failed restoration", html, err)
		}
	}
}

func TestPrimaryRichDynamicStylesRefreshAndStaticContentSurvives(t *testing.T) {
	engine := util.NewLute()
	paragraph := engine.BlockDOM2Tree(primaryRichTestDOM(`<span data-type="strong">same</span>`)).Root.FirstChild
	paragraph.ID = "20261110000000-source0"
	value := &av.Value{Type: av.KeyTypeBlock, Block: &av.ValueBlock{ID: paragraph.ID, Content: "same", RefSubtype: av.BlockRefSubtypeDynamic}}
	if !refreshAttributeViewPrimarySource(value, paragraph, "database") || value.Block.Rich == nil {
		t.Fatal("dynamic source missing")
	}
	first := value.Block.Rich.Content
	second := engine.BlockDOM2Tree(primaryRichTestDOM(`<span data-type="em">same</span>`)).Root.FirstChild
	second.ID = paragraph.ID
	if !refreshAttributeViewPrimarySource(value, second, "database") || value.Block.Content != "same" || first == value.Block.Rich.Content {
		t.Fatal("style-only change ignored")
	}
	value.Block.RefSubtype = av.BlockRefSubtypeStatic
	paragraph.SetIALAttr(av.NodeAttrViewStaticText+"-database", "same")
	static := value.Block.Rich.Content
	if refreshAttributeViewPrimarySource(value, paragraph, "database") {
		t.Fatal("static source changed through a source update")
	}
	if value.Block.Rich.Content != static {
		t.Fatal("static source overwritten")
	}
	value.Block.Rich = nil
	value.Block.RefSubtype = av.BlockRefSubtypeDynamic
	paragraph.RemoveIALAttr(av.NodeAttrViewStaticText + "-database")
	if !refreshAttributeViewPrimarySource(value, paragraph, "database") {
		t.Fatal("dynamic source not restored")
	}
}

func TestPrimaryRichAssetsReferencesExportAndHistory(t *testing.T) {
	engine := util.NewLute()
	tree := engine.BlockDOM2Tree(primaryRichTestDOM(`<span data-type="a" data-href="assets/a.pdf">file</span><span data-type="block-ref" data-id="20261110000000-target0" data-subtype="d">Target</span>`))
	source, err := render.NewDocumentTitle(tree.Root.FirstChild)
	if err != nil {
		t.Fatal(err)
	}
	value := &av.Value{Type: av.KeyTypeBlock, BlockID: "row", Block: &av.ValueBlock{Rich: source}}
	if err = value.Block.NormalizeRichContent(); err != nil {
		t.Fatal(err)
	}
	assets := getAttributeViewValueAssetsLinkDests(value, false)
	if len(assets) != 1 || assets[0] != "assets/a.pdf" {
		t.Fatal(assets)
	}
	database := &av.AttributeView{KeyValues: []*av.KeyValues{{Key: &av.Key{Type: av.KeyTypeBlock}, Values: []*av.Value{value}}}}
	if ids := attributeViewRichTextRefDefIDs(database); len(ids) != 1 || ids[0] != "20261110000000-target0" {
		t.Fatal(ids)
	}
	cell := &ast.Node{Type: ast.NodeTableCell}
	if err = appendAttributeViewPrimaryRichExport(cell, value, false); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(cell.FirstChild.Tokens), "assets/a.pdf") {
		t.Fatal("export lost asset link")
	}
	before, _ := json.Marshal(database)
	value.Block.Rich = &ast.DocumentTitle{Spec: source.Spec, Format: source.Format, Content: strings.ReplaceAll(source.Content, "file", "changed")}
	after, _ := json.Marshal(database)
	if docDiffAttributeViewSignature(before) == docDiffAttributeViewSignature(after) {
		t.Fatal("history omitted primary source")
	}
}

func TestPrimaryRichAutomationPatchesRetainCanonicalSourceAndExplicitPlainReplacement(t *testing.T) {
	paragraph := util.NewLute().BlockDOM2Tree(primaryRichTestDOM(`<span data-type="strong">Rich</span>`)).Root.FirstChild
	value := &av.Value{Type: av.KeyTypeBlock, IsDetached: true, Block: &av.ValueBlock{Rich: attributeViewNodePrimaryRich(paragraph)}}
	if err := value.Block.NormalizeRichContent(); err != nil {
		t.Fatal(err)
	}
	patch := automationValuePatch(value)
	data, _ := json.Marshal(patch)
	if strings.Contains(string(data), "richBlockDOM") || !strings.Contains(string(data), "inline-ast") {
		t.Fatal("automation undo omitted source or included runtime DOM", string(data))
	}
	updated := value.Clone()
	if err := prepareAttributeViewPrimaryRich(nil, updated, value, data, ""); err != nil || updated.Block.Rich == nil {
		t.Fatal("automation undo source rejected", err)
	}
	value.Block.Rich, value.Block.RichBlockDOM, value.Block.Content = nil, "", "plain"
	data, _ = json.Marshal(automationValuePatch(value))
	if !strings.Contains(string(data), `"rich":null`) {
		t.Fatal("automation plain replacement omitted explicit source clearing", string(data))
	}
}
