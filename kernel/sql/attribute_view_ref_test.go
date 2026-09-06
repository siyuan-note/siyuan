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
	gosql "database/sql"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestQueryAttributeViewRefDefIDsByBlockIDsInBox(t *testing.T) {
	testDB, err := gosql.Open("sqlite3_extended", ":memory:")
	if nil != err {
		t.Fatalf("open test database failed: %s", err)
	}
	testDB.SetMaxOpenConns(1)
	defer testDB.Close()
	if _, err = testDB.Exec("CREATE TABLE refs (id TEXT, def_block_id TEXT, def_block_parent_id TEXT, " +
		"def_block_root_id TEXT, def_block_path TEXT, block_id TEXT, root_id TEXT, box TEXT, path TEXT, " +
		"content TEXT, markdown TEXT, type TEXT)"); nil != err {
		t.Fatalf("create refs table failed: %s", err)
	}
	if _, err = testDB.Exec(`INSERT INTO refs VALUES
		('av-a-1', 'def-a', '', '', '', 'block-a', '', '', '', '', '', 'av'),
		('av-a-2', 'def-a', '', '', '', 'block-b', '', '', '', '', '', 'av'),
		('av-b', 'def-b', '', '', '', 'block-b', '', '', '', '', '', 'av'),
		('normal', 'def-normal', '', '', '', 'block-a', '', '', '', '', '', 'textmark'),
		('other', 'def-other', '', '', '', 'block-other', '', '', '', '', '', 'av')`); nil != err {
		t.Fatalf("insert refs failed: %s", err)
	}

	previousDB := db
	db = testDB
	defer func() {
		db = previousDB
	}()

	defIDs := QueryAttributeViewRefDefIDsByBlockIDsInBox(
		[]string{"block-a", "", "block-b", "block-a", `'); DELETE FROM refs --`}, "")
	actual := map[string]bool{}
	for _, defID := range defIDs {
		actual[defID] = true
	}
	if len(actual) != 2 || !actual["def-a"] || !actual["def-b"] || actual["def-normal"] || actual["def-other"] {
		t.Fatalf("unexpected attribute view definition IDs: %#v", actual)
	}

	var count int
	if err = testDB.QueryRow("SELECT COUNT(*) FROM refs").Scan(&count); nil != err || 5 != count {
		t.Fatalf("query argument changed stored refs: count=%d, err=%v", count, err)
	}
}

func TestQueryAttributeViewRefDefIDsByBlockIDsInEncryptedBox(t *testing.T) {
	testDB, boxID := useEncryptedQueryTestDB(t)
	if _, err := testDB.Exec("INSERT INTO refs (id, def_block_id, block_id, root_id, type) VALUES (?, ?, ?, ?, ?)",
		"encrypted-av-ref", "encrypted-def", "encrypted-database", "encrypted-root", AttributeViewRefType); nil != err {
		t.Fatalf("insert encrypted attribute view ref failed: %s", err)
	}

	defIDs := QueryAttributeViewRefDefIDsByBlockIDsInBox([]string{"encrypted-database"}, boxID)
	if len(defIDs) != 1 || "encrypted-def" != defIDs[0] {
		t.Fatalf("unexpected encrypted attribute view definition IDs: %#v", defIDs)
	}
}

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
