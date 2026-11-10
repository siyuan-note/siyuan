// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package av

import (
	"encoding/json"
	"os"
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/render"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func primaryRichFixture(t *testing.T, html string) *ast.DocumentTitle {
	t.Helper()
	tree := util.NewLute().BlockDOM2Tree(`<div data-type="NodeParagraph" data-node-id="20000101000000-primary"><div contenteditable="true">` + html + `</div></div>`)
	source, err := render.NewDocumentTitle(tree.Root.FirstChild)
	if err != nil {
		t.Fatal(err)
	}
	return source
}

func TestPrimaryRichSourceProjectionVersionAndRoundTrip(t *testing.T) {
	source := primaryRichFixture(t, `<span data-type="strong">same</span> <span data-type="inline-math" data-subtype="math" data-content="x^2"></span>`)
	value := &Value{Type: KeyTypeBlock, IsDetached: true, Block: &ValueBlock{Content: "stale", Rich: source}}
	database := &AttributeView{Spec: PlainTextSpec, KeyValues: []*KeyValues{{Key: &Key{Type: KeyTypeBlock}, Values: []*Value{value}}}}
	if CheckSpec(database) == nil {
		t.Fatal("rich source accepted with a plain storage version")
	}
	if err := database.NormalizeRichText(); err != nil {
		t.Fatal(err)
	}
	if value.Block.Content != "same x^2" || !strings.Contains(value.Block.RichBlockDOM, `data-type="strong"`) {
		t.Fatalf("projection mismatch: %+v", value.Block)
	}
	firstDOM := value.Block.RichBlockDOM
	if err := value.Block.NormalizeRichContent(); err != nil || firstDOM != value.Block.RichBlockDOM {
		t.Fatal("rendering source is unstable", err)
	}
	UpgradeSpec(database)
	if database.Spec != PrimaryRichSpec {
		t.Fatal("missing primary source version")
	}
	restore := database.suspendPrimaryRichDOM()
	encoded, err := json.Marshal(database)
	restore()
	if err != nil || strings.Contains(string(encoded), "richBlockDOM") {
		t.Fatal("runtime DOM entered storage", err)
	}
	loaded, err := ParseAttributeViewData("", encoded)
	if err != nil {
		t.Fatal(err)
	}
	if loaded.KeyValues[0].Values[0].Block.Rich.Content != source.Content {
		t.Fatal("full source was replaced by its projection")
	}
	value.Block.Rich = nil
	UpgradeSpec(database)
	if database.Spec != PrimaryRichSpec {
		t.Fatal("version was downgraded")
	}
}

func TestPrimaryRichRejectsUnknownSourceWithoutMutation(t *testing.T) {
	value := &ValueBlock{Content: "original", RichBlockDOM: "original DOM", Rich: &ast.DocumentTitle{Spec: 99, Format: "inline-ast", Content: "[]"}}
	if err := value.NormalizeRichContent(); err == nil {
		t.Fatal("future source was accepted")
	}
	if value.Content != "original" || value.RichBlockDOM != "original DOM" {
		t.Fatal("failed source read changed the value")
	}
	plain := &AttributeView{Spec: PlainTextSpec, KeyValues: []*KeyValues{{Values: []*Value{{Block: &ValueBlock{Content: "**literal**"}}}}}}
	if err := plain.NormalizeRichText(); err != nil {
		t.Fatal(err)
	}
	UpgradeSpec(plain)
	if plain.Spec != PlainTextSpec || plain.KeyValues[0].Values[0].Block.Rich != nil || plain.KeyValues[0].Values[0].Block.Content != "**literal**" {
		t.Fatal("legacy literal primary changed")
	}
}

func TestPrimaryRichUsesDocumentTitleInlineRange(t *testing.T) {
	for _, content := range []string{
		`<span data-type="code">code</span>`,
		`<span data-type="block-ref" data-id="20261110000000-target0" data-subtype="d">Target</span>`,
		`<span data-type="a" data-href="assets/a.pdf">asset</span>`,
		`<span class="img"><span><img src="assets/a.png" alt="image"></span></span>`,
	} {
		value := &Value{Type: KeyTypeBlock, Block: &ValueBlock{Rich: primaryRichFixture(t, content)}}
		tree, err := RichValueTree(value)
		if err != nil || tree == nil {
			t.Fatal(content, err)
		}
		if err = SetRichValueTree(value, tree); err != nil {
			t.Fatal(content, err)
		}
	}
}

func TestPrimaryRichPreviousSpec14Fixture(t *testing.T) {
	encoded, err := os.ReadFile("testdata/spec14-primary-plain.json")
	if err != nil {
		t.Fatal(err)
	}
	database, err := ParseAttributeViewData("20261110000000-avplain", encoded)
	if err != nil {
		t.Fatal(err)
	}
	value := database.GetBlockKeyValues().Values[0]
	if database.Spec != 14 || value.Block.Rich != nil || value.Block.Content != "**literal**" || value.Block.Icon != "1f4d6" {
		t.Fatal("previous primary format changed")
	}
	if tree, err := RichValueTree(value); err != nil || tree != nil {
		t.Fatal("literal source was reinterpreted", err)
	}
}

func TestPrimaryRichNormalizationIsAtomicWithTextFields(t *testing.T) {
	primary := &Value{Type: KeyTypeBlock, Block: &ValueBlock{Content: "original", RichBlockDOM: "original DOM",
		Rich: primaryRichFixture(t, `<span data-type="strong">new projection</span>`)}}
	text := &Value{Type: KeyTypeText, Text: &ValueText{Content: "original text",
		Rich: &ValueTextRich{Spec: 99, Format: ValueTextRichFormatKramdown, Content: "invalid"}}}
	database := &AttributeView{KeyValues: []*KeyValues{{Values: []*Value{primary, text}}}}
	if err := database.NormalizeRichText(); err == nil {
		t.Fatal("invalid text source accepted")
	}
	if primary.Block.Content != "original" || primary.Block.RichBlockDOM != "original DOM" || text.Text.Content != "original text" {
		t.Fatal("failed normalization partially changed projections")
	}
}
