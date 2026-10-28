//go:build fts5

package model

import (
	"bytes"
	"encoding/json"
	"slices"
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/av"
)

func TestImportSubItemsConfigurationReferences(t *testing.T) {
	_, source, _, _ := setupSubItemsTest(t, false)
	other := av.NewAttributeView(ast.NewNodeID())
	itemID := source.GetBlockKeyValues().Values[0].BlockID
	other.GetBlockKeyValues().Values = []*av.Value{{ID: ast.NewNodeID(), KeyID: other.GetBlockKey().ID, BlockID: itemID,
		Type: av.KeyTypeBlock, IsDetached: true, Block: &av.ValueBlock{Content: "Target"}}}
	other.Views[0].ItemIDs = []string{itemID}
	blockID, newBlockID := ast.NewNodeID(), ast.NewNodeID()
	textKey, urlKey := ast.NewNodeID(), ast.NewNodeID()
	source.KeyValues = append(source.KeyValues,
		&av.KeyValues{Key: &av.Key{ID: textKey, Type: av.KeyTypeText}, Values: []*av.Value{{ID: ast.NewNodeID(), KeyID: textKey, BlockID: itemID, Type: av.KeyTypeText,
			Text: &av.ValueText{Rich: &av.ValueTextRich{Spec: av.ValueTextRichSpec, Format: av.ValueTextRichFormatKramdown,
				Content: "literal " + blockID + " ((" + blockID + " 'Reference')) [Link](siyuan://blocks/" + blockID + ")"}}}}},
		&av.KeyValues{Key: &av.Key{ID: urlKey, Type: av.KeyTypeURL}, Values: []*av.Value{{ID: ast.NewNodeID(), KeyID: urlKey, BlockID: itemID, Type: av.KeyTypeURL,
			URL: &av.ValueURL{Content: "siyuan://blocks/" + blockID}}}})
	relationID, rollupID := ast.NewNodeID(), ast.NewNodeID()
	relationValue := &av.Value{Type: av.KeyTypeRelation, Relation: &av.ValueRelation{BlockIDs: []string{itemID}}}
	source.KeyValues = append(source.KeyValues,
		&av.KeyValues{Key: &av.Key{ID: relationID, Type: av.KeyTypeRelation, Relation: &av.Relation{AvID: other.ID,
			CandidateFilters: []*av.ViewFilter{{Column: other.GetBlockKey().ID}}}}},
		&av.KeyValues{Key: &av.Key{ID: rollupID, Type: av.KeyTypeRollup, Rollup: &av.Rollup{RelationKeyID: relationID,
			KeyID: other.GetBlockKey().ID, Filters: []*av.ViewFilter{{Column: other.GetBlockKey().ID}}}}})
	source.Views[0].Filters = []*av.ViewFilter{{Column: relationID, Value: relationValue.Clone()}}
	source.Views[0].Group = &av.ViewGroup{Field: relationID, Method: av.GroupMethodValue}
	source.Views[0].Groups = []*av.View{{ID: ast.NewNodeID(), GroupKey: source.KeyValues[len(source.KeyValues)-2].Key,
		GroupVal: relationValue.Clone(), GroupItemIDs: []string{itemID}}}
	source.NewItemTemplates = []*av.NewItemTemplate{{ID: ast.NewNodeID(), Name: source.ID, TargetType: av.NewItemTargetDetached,
		SaveLocation: &av.NewItemSaveLocation{BoxID: blockID},
		FieldValues:  map[string]*av.NewItemFieldValue{relationID: {Mode: av.NewItemFieldValueStatic, Value: relationValue.Clone()}}}}
	source.DefaultTemplateID = source.NewItemTemplates[0].ID
	source.Automations = &av.AutomationConfig{Spec: 8, Rules: []*av.AutomationRule{{ID: ast.NewNodeID(), Trigger: "added", Enabled: false,
		BlockSource: &av.AutomationBlockSource{DocumentIDs: []string{blockID}, NotebookIDs: []string{blockID}, ReferenceID: blockID},
		Conditions:  []*av.ViewFilter{{Column: relationID, Value: relationValue.Clone()}},
		Actions: []*av.AutomationAction{{Type: "edit", Target: "filtered", AvID: other.ID,
			Filters: []*av.ViewFilter{{Column: other.GetBlockKey().ID}},
			Fields:  map[string]*av.AutomationValue{other.GetBlockKey().ID: {Mode: "template", Template: `.action{field "` + source.GetBlockKey().ID + `"}`}}}}}}}
	inputs := map[string][]byte{}
	for _, database := range []*av.AttributeView{source, other} {
		data, err := json.Marshal(database)
		if err != nil {
			t.Fatal(err)
		}
		inputs[database.ID] = data
	}
	databaseIDs := map[string]string{source.ID: ast.NewNodeID(), other.ID: ast.NewNodeID()}
	result, mappings, err := remapImportedSubItemsDatabases(inputs, databaseIDs, map[string]string{blockID: newBlockID})
	if err != nil {
		t.Fatal(err)
	}
	imported, err := av.ParseAttributeViewData(databaseIDs[source.ID], result[source.ID])
	if err != nil {
		t.Fatal(err)
	}
	localIDs, targetIDs := mappings[source.ID], mappings[other.ID]
	rich := imported.GetValue(localIDs[textKey], localIDs[itemID]).Text.Rich.Content
	if !strings.Contains(rich, "literal "+blockID) || !strings.Contains(rich, newBlockID) || strings.Contains(rich, "siyuan://blocks/"+blockID) ||
		imported.GetValue(localIDs[urlKey], localIDs[itemID]).URL.Content != "siyuan://blocks/"+newBlockID {
		t.Fatalf("block references or literal text were remapped incorrectly: %s", rich)
	}
	relation, err := imported.GetKey(localIDs[relationID])
	if err != nil || relation.Relation.AvID != databaseIDs[other.ID] || relation.Relation.CandidateFilters[0].Column != targetIDs[other.GetBlockKey().ID] {
		t.Fatalf("candidate fields were not remapped in target scope: %v", err)
	}
	rollup, _ := imported.GetKey(localIDs[rollupID])
	if rollup.Rollup.RelationKeyID != relation.ID || rollup.Rollup.KeyID != targetIDs[other.GetBlockKey().ID] || rollup.Rollup.Filters[0].Column != targetIDs[other.GetBlockKey().ID] {
		t.Fatal("rollup fields were not remapped in target scope")
	}
	if imported.DefaultTemplateID != localIDs[source.DefaultTemplateID] || imported.NewItemTemplates[0].Name != source.ID || imported.NewItemTemplates[0].SaveLocation.BoxID != newBlockID ||
		!slices.Equal(imported.NewItemTemplates[0].FieldValues[relation.ID].Value.Relation.BlockIDs, []string{targetIDs[itemID]}) ||
		!slices.Equal(imported.Views[0].Filters[0].Value.Relation.BlockIDs, []string{targetIDs[itemID]}) {
		t.Fatal("template or view relation values lost their target scope")
	}
	group := imported.Views[0].Groups[0]
	if group.GroupKey.ID != relation.ID || group.GroupKey.Relation.AvID != databaseIDs[other.ID] ||
		group.GroupKey.Relation.CandidateFilters[0].Column != targetIDs[other.GetBlockKey().ID] ||
		!slices.Equal(group.GroupVal.Relation.BlockIDs, []string{targetIDs[itemID]}) {
		t.Fatal("relation group metadata lost its target database scope")
	}
	rule := imported.Automations.Rules[0]
	if !slices.Equal(rule.BlockSource.DocumentIDs, []string{newBlockID}) || !slices.Equal(rule.BlockSource.NotebookIDs, []string{newBlockID}) || rule.BlockSource.ReferenceID != newBlockID {
		t.Fatal("imported block collection source retained original references")
	}
	action := rule.Actions[0]
	if action.AvID != databaseIDs[other.ID] || action.Filters[0].Column != targetIDs[other.GetBlockKey().ID] ||
		action.Fields[targetIDs[other.GetBlockKey().ID]].Template != `.action{field "`+localIDs[source.GetBlockKey().ID]+`"}` ||
		!slices.Equal(rule.Conditions[0].Value.Relation.BlockIDs, []string{targetIDs[itemID]}) {
		t.Fatal("automation source and target identities were not remapped independently")
	}
	for _, database := range []*av.AttributeView{source, other} {
		original, _ := json.Marshal(database)
		if !bytes.Equal(inputs[database.ID], original) {
			t.Fatal("import rewrote its input")
		}
	}
	invalid := bytes.Replace(inputs[source.ID], []byte(`"spec":14`), []byte(`"spec":999`), 1)
	inputs[source.ID] = invalid
	if _, _, err = remapImportedSubItemsDatabases(inputs, databaseIDs, nil); err == nil || !bytes.Equal(inputs[source.ID], invalid) {
		t.Fatal("unsupported import format was accepted or its source was changed")
	}
}
