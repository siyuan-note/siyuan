// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5

package model

import (
	"bytes"
	"encoding/json"
	"reflect"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/av"
)

func relationDetailLifecycleDatabase() *av.AttributeView {
	keyID, itemID := ast.NewNodeID(), ast.NewNodeID()
	return &av.AttributeView{ID: ast.NewNodeID(), Spec: av.CurrentSpec,
		KeyValues: []*av.KeyValues{{Key: &av.Key{ID: keyID, Type: av.KeyTypeBlock}, Values: []*av.Value{{
			ID: ast.NewNodeID(), KeyID: keyID, BlockID: itemID, Type: av.KeyTypeBlock, IsDetached: true,
			Block: &av.ValueBlock{Content: "Entry"}}}}},
		Views: []*av.View{{ID: ast.NewNodeID(), LayoutType: av.LayoutTypeTable, Table: av.NewLayoutTable(), ItemIDs: []string{itemID}}}}
}

func addLifecycleDetailRelation(source, target *av.AttributeView) *av.Key {
	key := &av.Key{ID: ast.NewNodeID(), Type: av.KeyTypeRelation, Relation: &av.Relation{AvID: target.ID,
		DetailView: &av.RelationDetailView{Spec: 1, Enabled: true, ViewID: target.Views[0].ID}}}
	source.KeyValues = append(source.KeyValues, &av.KeyValues{Key: key})
	return key
}

func TestRelationDetailLifecycleCopy(t *testing.T) {
	source, external := relationDetailLifecycleDatabase(), relationDetailLifecycleDatabase()
	external.Views[0].ID = source.Views[0].ID
	self := addLifecycleDetailRelation(source, source)
	outbound := addLifecycleDetailRelation(source, external)
	outbound.Relation.DetailView.Enabled = false
	source.Name = source.Views[0].ID
	before, err := json.Marshal(source)
	if err != nil {
		t.Fatal(err)
	}
	newID := ast.NewNodeID()
	copied, err := remapCopiedSubItemsDatabase(source, newID)
	if err != nil {
		t.Fatal(err)
	}
	if copied.ID != newID || copied.Views[0].ID == source.Views[0].ID || copied.KeyValues[0].Key.ID == source.KeyValues[0].Key.ID {
		t.Fatal("detail configuration did not trigger identity-safe copying")
	}
	selfCopy, outboundCopy := copied.KeyValues[1].Key, copied.KeyValues[2].Key
	if selfCopy.ID == self.ID || selfCopy.Relation.AvID != newID || selfCopy.Relation.DetailView.ViewID != copied.Views[0].ID {
		t.Fatal("copied self-relation retained its original detail view")
	}
	if outboundCopy.Relation.AvID != external.ID || outboundCopy.Relation.DetailView.ViewID != external.Views[0].ID || outboundCopy.Relation.DetailView.Enabled {
		t.Fatal("copy remapped an external target or enabled a disabled configuration")
	}
	if copied.Name != source.Name {
		t.Fatal("copy changed literal text resembling a view ID")
	}
	after, _ := json.Marshal(source)
	if !bytes.Equal(before, after) {
		t.Fatal("copy changed its source")
	}
	if copied.KeyValues[1].Key.Relation.DetailView == self.Relation.DetailView {
		t.Fatal("copy retained a mutable configuration pointer")
	}
}

func TestRelationDetailLifecycleDuplicateDatabase(t *testing.T) {
	_, source, _, _ := setupAttributeViewItemsTest(t, false)
	key := addLifecycleDetailRelation(source, source)
	source.Name = source.ID
	itemID := source.GetBlockKeyValues().Values[0].BlockID
	source.KeyValues[len(source.KeyValues)-1].Values = []*av.Value{{ID: ast.NewNodeID(), KeyID: key.ID, BlockID: itemID,
		Type: av.KeyTypeRelation, Relation: &av.ValueRelation{BlockIDs: []string{itemID}}}}
	if err := av.SaveAttributeView(source); err != nil {
		t.Fatal(err)
	}
	newID, _, err := DuplicateDatabaseBlock(source.ID)
	if err != nil {
		t.Fatal(err)
	}
	copied, err := av.ParseAttributeView(newID)
	if err != nil {
		t.Fatal(err)
	}
	if copied.ID != newID || copied.Views[0].ID == source.Views[0].ID || copied.GetBlockKey().ID == source.GetBlockKey().ID {
		t.Fatal("database duplication skipped local identity mapping")
	}
	if !bytes.HasPrefix([]byte(copied.Name), []byte(source.ID+" (Duplicated ")) {
		t.Fatal("database duplication rewrote a literal source ID")
	}
	self := copied.KeyValues[len(copied.KeyValues)-1]
	if self.Key.Relation.AvID != newID || self.Key.Relation.DetailView.ViewID != copied.Views[0].ID {
		t.Fatal("database duplication did not map the self-related detail view")
	}
	if len(self.Values) != 1 || len(self.Values[0].Relation.BlockIDs) != 1 || self.Values[0].Relation.BlockIDs[0] == itemID ||
		self.Values[0].Relation.BlockIDs[0] != copied.GetBlockKeyValues().Values[0].BlockID {
		t.Fatal("database duplication changed relation membership scope")
	}
}

func TestRelationDetailLifecycleImportTargetScope(t *testing.T) {
	source, target, external := relationDetailLifecycleDatabase(), relationDetailLifecycleDatabase(), relationDetailLifecycleDatabase()
	target.Views[0].ID = source.Views[0].ID
	external.Views[0].ID = source.Views[0].ID
	self := addLifecycleDetailRelation(source, source)
	packaged := addLifecycleDetailRelation(source, target)
	outbound := addLifecycleDetailRelation(source, external)
	source.Views[0].Groups = []*av.View{{ID: ast.NewNodeID(), GroupKey: packaged}}
	source.Name = target.Views[0].ID
	inputs := map[string][]byte{}
	for _, database := range []*av.AttributeView{source, target} {
		encoded, err := json.Marshal(database)
		if err != nil {
			t.Fatal(err)
		}
		inputs[database.ID] = encoded
	}
	databaseIDs := map[string]string{source.ID: ast.NewNodeID(), target.ID: ast.NewNodeID()}
	result, mappings, err := remapImportedSubItemsDatabases(inputs, databaseIDs, nil)
	if err != nil || result == nil {
		t.Fatalf("detail configuration did not trigger identity-safe import: %v", err)
	}
	imported, err := av.ParseAttributeViewData(databaseIDs[source.ID], result[source.ID])
	if err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct {
		keyID, databaseID, viewID string
	}{
		{self.ID, databaseIDs[source.ID], mappings[source.ID][source.Views[0].ID]},
		{packaged.ID, databaseIDs[target.ID], mappings[target.ID][target.Views[0].ID]},
		{outbound.ID, external.ID, external.Views[0].ID},
	} {
		key, err := imported.GetKey(mappings[source.ID][test.keyID])
		if err != nil || key.Relation.AvID != test.databaseID || key.Relation.DetailView.ViewID != test.viewID {
			t.Fatalf("detail view was not mapped in its target database: %v %+v", err, key)
		}
	}
	group := imported.Views[0].Groups[0]
	if group.GroupKey.Relation.DetailView.ViewID != mappings[target.ID][target.Views[0].ID] {
		t.Fatal("group relation metadata used the wrong detail view scope")
	}
	if imported.Name != source.Name {
		t.Fatal("import rewrote literal text resembling a view ID")
	}
	for _, database := range []*av.AttributeView{source, target} {
		original, _ := json.Marshal(database)
		if !bytes.Equal(original, inputs[database.ID]) {
			t.Fatal("import changed its input")
		}
	}
}

func TestRelationDetailLifecycleUnknownPayload(t *testing.T) {
	source := relationDetailLifecycleDatabase()
	key := addLifecycleDetailRelation(source, source)
	raw := `{"spec":99,"enabled":{"next":true},"viewID":"` + source.Views[0].ID +
		`","future":{"id":"` + source.GetBlockKey().ID + `","blockID":"` + source.ID + `","number":9007199254740993}}`
	if err := json.Unmarshal([]byte(raw), key.Relation.DetailView); err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(source)
	if err != nil {
		t.Fatal(err)
	}
	newID := ast.NewNodeID()
	result, mappings, err := remapImportedSubItemsDatabases(map[string][]byte{source.ID: encoded}, map[string]string{source.ID: newID}, nil)
	if err != nil {
		t.Fatal(err)
	}
	imported, err := av.ParseAttributeViewData(newID, result[source.ID])
	if err != nil {
		t.Fatal(err)
	}
	importedKey, _ := imported.GetKey(mappings[source.ID][key.ID])
	retained, err := json.Marshal(importedKey.Relation.DetailView)
	if err != nil {
		t.Fatal(err)
	}
	var expected, actual map[string]json.RawMessage
	if err = json.Unmarshal([]byte(raw), &expected); err != nil {
		t.Fatal(err)
	}
	if err = json.Unmarshal(retained, &actual); err != nil {
		t.Fatal(err)
	}
	// JSON 对象键顺序可以变化，未知字段的值和精度必须保持。
	for name, want := range expected {
		var wantValue, gotValue any
		decoder := json.NewDecoder(bytes.NewReader(want))
		decoder.UseNumber()
		if err = decoder.Decode(&wantValue); err != nil {
			t.Fatal(err)
		}
		decoder = json.NewDecoder(bytes.NewReader(actual[name]))
		decoder.UseNumber()
		if err = decoder.Decode(&gotValue); err != nil || !reflect.DeepEqual(wantValue, gotValue) {
			t.Fatalf("unknown %s changed: %s %v", name, retained, err)
		}
	}
	if importedKey.Relation.DetailView.Validate() == nil {
		t.Fatal("import made an unsupported configuration executable")
	}
}

func TestRelationDetailLifecycleTemplateCopy(t *testing.T) {
	source, target := relationDetailLifecycleDatabase(), relationDetailLifecycleDatabase()
	key := addLifecycleDetailRelation(source, target)
	copied, err := copyTemplateAttributeView(source)
	if err != nil {
		t.Fatal(err)
	}
	if copied.target.KeyValues[1].Key.Relation.DetailView != nil || copied.target.KeyValues[1].Key.Relation.AvID != "" {
		t.Fatal("template copy retained configuration for a disconnected target")
	}
	if key.Relation.DetailView == nil || key.Relation.DetailView.ViewID != target.Views[0].ID {
		t.Fatal("template copy changed the source configuration")
	}
	if copied.copiedViewIDs[source.Views[0].ID] != copied.target.Views[0].ID {
		t.Fatal("template copy did not retain the view mapping")
	}
}
