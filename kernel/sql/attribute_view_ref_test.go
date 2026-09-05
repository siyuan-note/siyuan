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

package sql

import (
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestRefsFromTreeIncludesAttributeViewRichTextReferences(t *testing.T) {
	const (
		rootID        = "20260904009000-root001"
		databaseID    = "20260904009001-db00001"
		defID         = "20260904009002-def0001"
		attributeView = "20260904009003-av00001"
	)
	originalDataDir, originalLang, originalLangs := util.DataDir, util.Lang, util.AttrViewLangs
	util.DataDir = t.TempDir()
	util.Lang = "en"
	util.AttrViewLangs = map[string]map[string]any{
		"en": {"key": "Key", "select": "Select", "table": "Table"},
	}
	t.Cleanup(func() {
		cache.RemoveAVData(attributeView)
		util.DataDir, util.Lang, util.AttrViewLangs = originalDataDir, originalLang, originalLangs
	})

	attrView := av.NewAttributeView(attributeView)
	textKey := &av.Key{ID: "text", Type: av.KeyTypeText}
	attrView.KeyValues = append(attrView.KeyValues, &av.KeyValues{
		Key: textKey,
		Values: []*av.Value{{Type: av.KeyTypeText, Text: &av.ValueText{
			Rich: &av.ValueTextRich{
				Spec: av.ValueTextRichSpec, Format: av.ValueTextRichFormatKramdown,
				Content: "((" + defID + " \"Reference\"))",
			},
		}}},
	})
	if err := av.SaveAttributeView(attrView); nil != err {
		t.Fatal(err)
	}

	root := &ast.Node{Type: ast.NodeDocument, ID: rootID}
	databaseNode := &ast.Node{Type: ast.NodeAttributeView, ID: databaseID, AttributeViewID: attributeView}
	root.AppendChild(databaseNode)
	tree := &parse.Tree{Root: root, ID: rootID, Box: "20260904009004-box0001", Path: "/" + rootID + ".sy"}
	refs, _ := refsFromTree(tree)
	if 1 != len(refs) || defID != refs[0].DefBlockID || databaseID != refs[0].BlockID || AttributeViewRefType != refs[0].Type {
		t.Fatalf("unexpected attribute view references: %+v", refs)
	}
}

func TestAttributeViewRefsUseCarrierDatabaseBlock(t *testing.T) {
	const (
		rootID        = "20260904010000-root001"
		databaseID    = "20260904010001-db00001"
		firstDefID    = "20260904010002-def0001"
		secondDefID   = "20260904010003-def0002"
		attributeView = "20260904010004-av00001"
	)
	tree := &parse.Tree{
		Root:  &ast.Node{Type: ast.NodeDocument, ID: rootID},
		ID:    rootID,
		Box:   "20260904010005-box0001",
		Path:  "/" + rootID + ".sy",
		HPath: "/Database",
	}
	databaseNode := &ast.Node{Type: ast.NodeAttributeView, ID: databaseID, AttributeViewID: attributeView}
	attrView := &av.AttributeView{KeyValues: []*av.KeyValues{
		{
			Key: &av.Key{ID: "text", Type: av.KeyTypeText},
			Values: []*av.Value{{Type: av.KeyTypeText, Text: &av.ValueText{
				Content: "First and second",
				Rich: &av.ValueTextRich{
					Spec: av.ValueTextRichSpec, Format: av.ValueTextRichFormatKramdown,
					Content: `<span data-type="block-ref text" data-id="` + firstDefID +
						`" data-subtype="d" style="color: var(--b3-font-color8);">First</span> and ((` +
						secondDefID + ` "Second")) and ((` + firstDefID + ` 'First again'))`,
				},
			}}},
		},
	}}

	refs := attributeViewRefs(tree, databaseNode, attrView)
	if 2 != len(refs) {
		t.Fatalf("expected references to be deduplicated by carrier and definition, got %d", len(refs))
	}
	byDefinition := map[string]*Ref{}
	for _, ref := range refs {
		byDefinition[ref.DefBlockID] = ref
		if databaseID != ref.BlockID || rootID != ref.RootID || tree.Box != ref.Box || tree.Path != ref.Path {
			t.Fatalf("reference source is not the carrier database block: %+v", ref)
		}
		if AttributeViewRefType != ref.Type {
			t.Fatalf("unexpected attribute view reference type: %q", ref.Type)
		}
	}
	if "First" != byDefinition[firstDefID].Content || "Second" != byDefinition[secondDefID].Content {
		t.Fatalf("unexpected reference anchors: %+v", byDefinition)
	}
}

func TestAttributeViewRefsIgnoreLegacyPlainTextAndDerivedValues(t *testing.T) {
	const defID = "20260904010002-def0001"
	tree := &parse.Tree{Root: &ast.Node{Type: ast.NodeDocument}, ID: "root", Box: "box", Path: "/root.sy"}
	databaseNode := &ast.Node{Type: ast.NodeAttributeView, ID: "database"}
	attrView := &av.AttributeView{KeyValues: []*av.KeyValues{
		{
			Key: &av.Key{ID: "legacy", Type: av.KeyTypeText},
			Values: []*av.Value{{Type: av.KeyTypeText, Text: &av.ValueText{
				Content: "((" + defID + " \"literal plain text\"))",
			}}},
		},
		{
			Key: &av.Key{ID: "rollup", Type: av.KeyTypeRollup},
			Values: []*av.Value{{Type: av.KeyTypeRollup, Rollup: &av.ValueRollup{Contents: []*av.Value{{
				Type: av.KeyTypeText,
				Text: &av.ValueText{Rich: &av.ValueTextRich{
					Spec: av.ValueTextRichSpec, Format: av.ValueTextRichFormatKramdown,
					Content: "((" + defID + " \"derived\"))",
				}},
			}}}}},
		},
	}}

	if refs := attributeViewRefs(tree, databaseNode, attrView); 0 != len(refs) {
		t.Fatalf("legacy or derived values produced attribute view references: %+v", refs)
	}
}

func TestAttributeViewRefStorageBoxIDKeepsCryptoBoundary(t *testing.T) {
	original := IsEncryptedBoxFn
	IsEncryptedBoxFn = func(boxID string) bool {
		return "20260904010000-encbox1" == boxID
	}
	t.Cleanup(func() {
		IsEncryptedBoxFn = original
	})

	if actual := attributeViewRefStorageBoxID("20260904010000-box0001"); "" != actual {
		t.Fatalf("normal carrier should use global attribute view storage, got %q", actual)
	}
	if actual := attributeViewRefStorageBoxID("20260904010000-encbox1"); "20260904010000-encbox1" != actual {
		t.Fatalf("encrypted carrier should use its exact storage boundary, got %q", actual)
	}
}
