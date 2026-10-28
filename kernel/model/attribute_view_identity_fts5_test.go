//go:build fts5

package model

import (
	"encoding/json"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/sql"
)

func TestSubItemsCopyAndImportTemplateFieldReferences(t *testing.T) {
	_, source, _, _ := setupSubItemsTest(t, false)
	var textKey *av.Key
	for _, kv := range source.KeyValues {
		if kv.Key.Type == av.KeyTypeText {
			textKey = kv.Key
			break
		}
	}
	source.GetBlockKey().RenderTemplate = `.action{index .id_mod "` + textKey.ID + `"}`
	templateKey := av.NewKey(ast.NewNodeID(), "Computed", "", av.KeyTypeTemplate)
	templateKey.Template = `.action{$fields := .id_mod}.action{index $fields "` + textKey.ID + `"}`
	addAttributeViewKey(source, source.Views[0], templateKey, "")
	render := func(database *av.AttributeView, computedKeyID string) (string, string) {
		database.RenderedViewables = map[string]av.Viewable{}
		collection := sql.RenderView(database, database.Views[0], "", false).(av.Collection)
		row := database.Views[0].ItemIDs[0]
		return collection.GetValue(row, database.GetBlockKey().ID).RenderedContent, collection.GetValue(row, computedKeyID).Template.Content
	}
	wantDisplay, wantComputed := render(source, templateKey.ID)
	if wantDisplay != "private field contents" || wantComputed != wantDisplay {
		t.Fatalf("invalid template fixture: %q, %q", wantDisplay, wantComputed)
	}
	copy, err := remapCopiedSubItemsDatabase(source)
	if err != nil {
		t.Fatal(err)
	}
	computedIndex := len(source.KeyValues) - 1
	if display, computed := render(copy, copy.KeyValues[computedIndex].Key.ID); display != wantDisplay || computed != wantComputed {
		t.Fatalf("copy changed template output: %q, %q", display, computed)
	}
	encoded, err := json.Marshal(source)
	if err != nil {
		t.Fatal(err)
	}
	newID := ast.NewNodeID()
	data, mappings, err := remapImportedSubItemsDatabases(map[string][]byte{source.ID: encoded}, map[string]string{source.ID: newID}, nil)
	if err != nil {
		t.Fatal(err)
	}
	imported, err := av.ParseAttributeViewData(newID, data[source.ID])
	if err != nil {
		t.Fatal(err)
	}
	if display, computed := render(imported, mappings[source.ID][templateKey.ID]); display != wantDisplay || computed != wantComputed {
		t.Fatalf("native import changed template output: %q, %q", display, computed)
	}
}
