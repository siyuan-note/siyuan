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
	"errors"
	"testing"
	"time"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
)

func TestRenderViewableInstanceAppliesContextFilterToEveryView(t *testing.T) {
	relationKey := &av.Key{
		ID: "relation", Type: av.KeyTypeRelation, Relation: &av.Relation{AvID: "projects"},
	}
	textKey := &av.Key{ID: "status", Type: av.KeyTypeText}
	attrView := &av.AttributeView{KeyValues: []*av.KeyValues{
		{Key: relationKey, Values: []*av.Value{
			newContextFilterRelationValue(relationKey.ID, "alpha-open", "project-alpha"),
			newContextFilterRelationValue(relationKey.ID, "alpha-closed", "project-alpha"),
			newContextFilterRelationValue(relationKey.ID, "beta-open", "project-beta"),
			newContextFilterRelationValue(relationKey.ID, "beta-closed", "project-beta"),
		}},
		{Key: textKey},
	}}
	context := &av.FilterContext{KeyID: relationKey.ID, CurrentDocumentItemIDs: []string{"project-alpha"}}

	for _, layoutType := range []av.LayoutType{av.LayoutTypeTable, av.LayoutTypeGallery, av.LayoutTypeKanban} {
		t.Run(string(layoutType), func(t *testing.T) {
			view := &av.View{
				ID:         "view-" + string(layoutType),
				LayoutType: layoutType,
				PageSize:   10,
				Filters: []*av.ViewFilter{{
					Combination: av.FilterCombinationAnd,
					Filters: []*av.ViewFilter{{
						Column: textKey.ID, Operator: av.FilterOperatorIsEqual,
						Value: &av.Value{Type: av.KeyTypeText, Text: &av.ValueText{Content: "open"}},
					}},
				}},
			}
			field := &av.BaseInstanceField{ID: textKey.ID, Type: textKey.Type}
			var viewable av.Viewable
			switch layoutType {
			case av.LayoutTypeTable:
				view.Table = av.NewLayoutTable()
				viewable = &av.Table{
					BaseInstance: av.NewViewBaseInstance(view),
					Columns:      []*av.TableColumn{{BaseInstanceField: field}},
					Rows: []*av.TableRow{
						newContextFilterTextTableRow("alpha-open", textKey.ID, "open"),
						newContextFilterTextTableRow("alpha-closed", textKey.ID, "closed"),
						newContextFilterTextTableRow("beta-open", textKey.ID, "open"),
					},
				}
			case av.LayoutTypeGallery:
				view.Gallery = av.NewLayoutGallery()
				viewable = &av.Gallery{
					BaseInstance: av.NewViewBaseInstance(view),
					Fields:       []*av.GalleryField{{BaseInstanceField: field}},
					Cards: []*av.GalleryCard{
						newContextFilterGalleryCard("alpha-open", textKey.ID, "open"),
						newContextFilterGalleryCard("alpha-closed", textKey.ID, "closed"),
						newContextFilterGalleryCard("beta-open", textKey.ID, "open"),
					},
				}
			case av.LayoutTypeKanban:
				view.Kanban = av.NewLayoutKanban()
				viewable = &av.Kanban{
					BaseInstance: av.NewViewBaseInstance(view),
					Fields:       []*av.KanbanField{{BaseInstanceField: field}},
					Cards: []*av.KanbanCard{
						newContextFilterKanbanCard("alpha-open", textKey.ID, "open"),
						newContextFilterKanbanCard("alpha-closed", textKey.ID, "closed"),
						newContextFilterKanbanCard("beta-open", textKey.ID, "open"),
					},
				}
			}

			if _, _, err := renderViewableInstance(viewable, view, attrView, 1, 10, false, "",
				sql.NewAttributeViewRenderContext(), context); nil != err {
				t.Fatal(err)
			}
			items := viewable.(av.Collection).GetItems()
			if 1 != len(items) || "alpha-open" != items[0].GetID() {
				t.Fatalf("context and view filters should be combined with AND: %+v", items)
			}
		})
	}
}

func newContextFilterTextBaseValue(id, keyID, content string) *av.BaseValue {
	return &av.BaseValue{ValueType: av.KeyTypeText, Value: &av.Value{
		KeyID: keyID, BlockID: id, Type: av.KeyTypeText, Text: &av.ValueText{Content: content},
	}}
}

func newContextFilterTextTableRow(id, keyID, content string) *av.TableRow {
	return &av.TableRow{ID: id, Cells: []*av.TableCell{{BaseValue: newContextFilterTextBaseValue(id, keyID, content)}}}
}

func newContextFilterGalleryCard(id, keyID, content string) *av.GalleryCard {
	return &av.GalleryCard{ID: id, Values: []*av.GalleryFieldValue{{
		BaseValue: newContextFilterTextBaseValue(id, keyID, content),
	}}}
}

func newContextFilterKanbanCard(id, keyID, content string) *av.KanbanCard {
	return &av.KanbanCard{ID: id, Values: []*av.KanbanFieldValue{{
		BaseValue: newContextFilterTextBaseValue(id, keyID, content),
	}}}
}

func newContextFilterRelationValue(keyID, blockID, relationItemID string) *av.Value {
	return &av.Value{
		KeyID: keyID, BlockID: blockID, Type: av.KeyTypeRelation,
		Relation: &av.ValueRelation{BlockIDs: []string{relationItemID}},
	}
}

func TestContextFilterProvidesNewItemDefaultForEveryView(t *testing.T) {
	relationKey := &av.Key{
		ID: "relation", Type: av.KeyTypeRelation, Relation: &av.Relation{AvID: "projects"},
	}
	textKey := &av.Key{ID: "status", Type: av.KeyTypeText}
	attrView := &av.AttributeView{
		ID: "context-defaults", KeyValues: []*av.KeyValues{{Key: relationKey}, {Key: textKey}},
		RenderedViewables: map[string]av.Viewable{},
	}
	context := &av.FilterContext{KeyID: relationKey.ID, CurrentDocumentItemIDs: []string{"project-alpha"}}

	for _, status := range []string{"open", "closed"} {
		t.Run(status, func(t *testing.T) {
			layout := av.NewLayoutTable()
			layout.Columns = []*av.ViewTableColumn{
				{BaseField: &av.BaseField{ID: relationKey.ID}},
				{BaseField: &av.BaseField{ID: textKey.ID}},
			}
			view := &av.View{
				ID: "view-" + status, LayoutType: av.LayoutTypeTable,
				Table: layout,
				Filters: []*av.ViewFilter{{
					Combination: av.FilterCombinationAnd,
					Filters: []*av.ViewFilter{{
						Column: textKey.ID, Operator: av.FilterOperatorIsEqual,
						Value: &av.Value{Type: av.KeyTypeText, Text: &av.ValueText{Content: status}},
					}},
				}}}
			groupView := *view
			groupView.Table = av.NewLayoutTable()
			values := getAttrViewAddingBlockDefaultValues(attrView, view, &groupView, "", "new-item", true, false, context)
			relationValue := values[relationKey.ID]
			if nil == relationValue || nil == relationValue.Relation ||
				1 != len(relationValue.Relation.BlockIDs) || "project-alpha" != relationValue.Relation.BlockIDs[0] {
				t.Fatalf("unexpected context relation default: %#v", relationValue)
			}
			textValue := values[textKey.ID]
			if nil == textValue || nil == textValue.Text || status != textValue.Text.Content {
				t.Fatalf("unexpected view filter default: %#v", textValue)
			}
		})
	}
}

func TestMergeNewItemTemplateAndContextRelationsKeepsTwoWayValues(t *testing.T) {
	fixture := setupDatabaseBlockTransactionTest(t, true)
	const blockID = "20260803091003-avblock"

	target := av.NewAttributeView(ast.NewNodeID())
	relationKey := av.NewKey(ast.NewNodeID(), "Project", "", av.KeyTypeRelation)
	backRelationKey := av.NewKey(ast.NewNodeID(), "Tasks", "", av.KeyTypeRelation)
	relationKey.Relation = &av.Relation{
		AvID: target.ID, IsTwoWay: true, BackKeyID: backRelationKey.ID,
	}
	backRelationKey.Relation = &av.Relation{
		AvID: fixture.attrView.ID, IsTwoWay: true, BackKeyID: relationKey.ID,
	}
	fixture.attrView.KeyValues = append(fixture.attrView.KeyValues, &av.KeyValues{Key: relationKey})
	target.KeyValues = append(target.KeyValues, &av.KeyValues{Key: backRelationKey})

	currentProjectID := ast.NewNodeID()
	staticProjectID := ast.NewNodeID()
	target.GetBlockKeyValues().Values = append(target.GetBlockKeyValues().Values,
		&av.Value{
			ID: ast.NewNodeID(), KeyID: target.GetBlockKey().ID, BlockID: currentProjectID, Type: av.KeyTypeBlock,
			Block: &av.ValueBlock{ID: fixture.tree.Root.ID, Content: "Current project"},
		},
		&av.Value{
			ID: ast.NewNodeID(), KeyID: target.GetBlockKey().ID, BlockID: staticProjectID, Type: av.KeyTypeBlock,
			IsDetached: true, Block: &av.ValueBlock{Content: "Static project"},
		},
	)
	for _, view := range target.Views {
		view.ItemIDs = append(view.ItemIDs, currentProjectID, staticProjectID)
	}
	if err := av.SaveAttributeView(target); nil != err {
		t.Fatal(err)
	}

	templateID := ast.NewNodeID()
	if err := fixture.attrView.SetNewItemTemplates(&av.NewItemTemplatesConfig{Templates: []*av.NewItemTemplate{{
		ID: templateID, Name: "With static project", TargetType: av.NewItemTargetDetached,
		FieldValues: map[string]*av.NewItemFieldValue{
			relationKey.ID: {
				Mode: av.NewItemFieldValueStatic,
				Value: &av.Value{Type: av.KeyTypeRelation, Relation: &av.ValueRelation{
					BlockIDs: []string{staticProjectID, staticProjectID},
				}},
			},
		},
	}}}); nil != err {
		t.Fatal(err)
	}
	if err := av.SaveAttributeView(fixture.attrView); nil != err {
		t.Fatal(err)
	}
	if _, err := setAttributeViewContextFilterForTest(blockID, fixture.attrView.ID, relationKey.ID); nil != err {
		t.Fatal(err)
	}

	itemTemplate := fixture.attrView.GetNewItemTemplate(templateID)
	fieldValues, err := resolveNewItemFieldValues(fixture.attrView, itemTemplate, time.Now(), fixture.tree.Box)
	if nil != err {
		t.Fatal(err)
	}
	filterContext, err := resolveAttributeViewFilterContext(fixture.attrView, fixture.tableView, blockID)
	if nil != err {
		t.Fatal(err)
	}
	itemID := ast.NewNodeID()
	applyAttributeViewContextFilterDefaultValue(fixture.attrView, itemID, filterContext, fieldValues)
	operations := buildNewItemFieldValueOperations(fixture.attrView, fieldValues, itemID, blockID)
	if 1 != len(operations) || blockID != operations[0].BlockID {
		t.Fatalf("unexpected template field operations: %+v", operations)
	}

	fixture.attrView.GetBlockKeyValues().Values = append(fixture.attrView.GetBlockKeyValues().Values, &av.Value{
		ID: ast.NewNodeID(), KeyID: fixture.attrView.GetBlockKey().ID, BlockID: itemID, Type: av.KeyTypeBlock,
		IsDetached: true, Block: &av.ValueBlock{Content: "New task"},
	})
	if err = fillAttributeViewContextFilterValue(fixture.attrView, fixture.tableView, itemID, filterContext,
		blockID); nil != err {
		t.Fatal(err)
	}
	if _, err = updateAttributeViewValue(nil, fixture.attrView, relationKey.ID, itemID,
		fieldValues[relationKey.ID], false); nil != err {
		t.Fatal(err)
	}
	assertContextFilterRelationIDs(t, fixture.attrView.GetValue(relationKey.ID, itemID),
		staticProjectID, currentProjectID)

	updatedTarget, err := av.ParseAttributeView(target.ID)
	if nil != err {
		t.Fatal(err)
	}
	assertContextFilterRelationIDs(t, updatedTarget.GetValue(backRelationKey.ID, staticProjectID), itemID)
	assertContextFilterRelationIDs(t, updatedTarget.GetValue(backRelationKey.ID, currentProjectID), itemID)
}

func assertContextFilterRelationIDs(t *testing.T, value *av.Value, expected ...string) {
	t.Helper()
	if nil == value || nil == value.Relation {
		t.Fatalf("expected a relation value, got %#v", value)
	}
	counts := map[string]int{}
	for _, id := range value.Relation.BlockIDs {
		counts[id]++
	}
	if len(expected) != len(value.Relation.BlockIDs) {
		t.Fatalf("unexpected relation IDs: %v", value.Relation.BlockIDs)
	}
	for _, id := range expected {
		if 1 != counts[id] {
			t.Fatalf("relation ID %q occurred %d times in %v", id, counts[id], value.Relation.BlockIDs)
		}
	}
}

func TestSetAttributeViewContextFilterPersistsPerDatabaseBlock(t *testing.T) {
	fixture := setupDatabaseBlockTransactionTest(t, true)
	firstKey := &av.Key{
		ID: "first-relation", Type: av.KeyTypeRelation, Relation: &av.Relation{AvID: fixture.attrView.ID},
	}
	secondKey := &av.Key{
		ID: "second-relation", Type: av.KeyTypeRelation, Relation: &av.Relation{AvID: fixture.attrView.ID},
	}
	fixture.attrView.KeyValues = append(fixture.attrView.KeyValues,
		&av.KeyValues{Key: firstKey}, &av.KeyValues{Key: secondKey})
	if err := av.SaveAttributeView(fixture.attrView); nil != err {
		t.Fatal(err)
	}

	const firstBlockID = "20260803091003-avblock"
	const secondBlockID = "20260803091004-mirror0"
	secondNode := &ast.Node{
		Type:              ast.NodeAttributeView,
		ID:                secondBlockID,
		AttributeViewID:   fixture.attrView.ID,
		AttributeViewType: string(av.LayoutTypeTable),
	}
	secondNode.SetIALAttr("id", secondBlockID)
	secondNode.SetIALAttr(av.NodeAttrView, fixture.tableView.ID)
	fixture.tree.Root.AppendChild(secondNode)
	if _, err := filesys.WriteTree(fixture.tree); nil != err {
		t.Fatal(err)
	}
	treenode.UpsertBlockTree(fixture.tree)

	firstFilter, err := setAttributeViewContextFilterForTest(firstBlockID, fixture.attrView.ID, firstKey.ID)
	if nil != err {
		t.Fatal(err)
	}
	if nil == firstFilter || firstKey.ID != firstFilter.KeyID {
		t.Fatalf("unexpected first context filter: %#v", firstFilter)
	}
	assertDatabaseBlockContextFilter(t, firstBlockID, firstKey.ID)
	assertDatabaseBlockContextFilter(t, secondBlockID, "")

	secondFilter, err := setAttributeViewContextFilterForTest(secondBlockID, fixture.attrView.ID, secondKey.ID)
	if nil != err {
		t.Fatal(err)
	}
	if nil == secondFilter || secondKey.ID != secondFilter.KeyID {
		t.Fatalf("unexpected second context filter: %#v", secondFilter)
	}
	assertDatabaseBlockContextFilter(t, firstBlockID, firstKey.ID)
	assertDatabaseBlockContextFilter(t, secondBlockID, secondKey.ID)

	cleared, err := setAttributeViewContextFilterForTest(firstBlockID, fixture.attrView.ID, "")
	if nil != err {
		t.Fatal(err)
	}
	if nil != cleared {
		t.Fatalf("clearing should not return a context filter: %#v", cleared)
	}
	assertDatabaseBlockContextFilter(t, firstBlockID, "")
	assertDatabaseBlockContextFilter(t, secondBlockID, secondKey.ID)
}

func TestSetAttributeViewContextFilterRejectsInvalidCarrierAndKey(t *testing.T) {
	fixture := setupDatabaseBlockTransactionTest(t, true)
	const blockID = "20260803091003-avblock"
	missingTargetKey := &av.Key{
		ID: "missing-target-relation", Type: av.KeyTypeRelation,
		Relation: &av.Relation{AvID: "20260904004000-missing"},
	}
	fixture.attrView.KeyValues = append(fixture.attrView.KeyValues, &av.KeyValues{Key: missingTargetKey})
	if err := av.SaveAttributeView(fixture.attrView); nil != err {
		t.Fatal(err)
	}

	tests := []struct {
		name    string
		blockID string
		avID    string
		keyID   string
	}{
		{name: "missing carrier", avID: fixture.attrView.ID, keyID: fixture.attrView.KeyValues[1].Key.ID},
		{name: "unknown carrier", blockID: "20260803091005-missing", avID: fixture.attrView.ID, keyID: fixture.attrView.KeyValues[1].Key.ID},
		{name: "wrong attribute view", blockID: blockID, avID: "20260803091006-otherav", keyID: fixture.attrView.KeyValues[1].Key.ID},
		{name: "non relation key", blockID: blockID, avID: fixture.attrView.ID, keyID: fixture.attrView.KeyValues[1].Key.ID},
		{name: "unknown key", blockID: blockID, avID: fixture.attrView.ID, keyID: "missing-key"},
		{name: "missing relation target", blockID: blockID, avID: fixture.attrView.ID, keyID: missingTargetKey.ID},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if _, err := setAttributeViewContextFilterForTest(test.blockID, test.avID, test.keyID); nil == err {
				t.Fatal("invalid context filter should return an error")
			}
			assertDatabaseBlockContextFilter(t, blockID, "")
		})
	}
}

func TestResolveAttributeViewContextFilterValidatesCarrier(t *testing.T) {
	t.Run("ordinary block attribute panel", func(t *testing.T) {
		fixture := setupDatabaseBlockTransactionTest(t, false)
		view := fixture.attrView.Views[0]
		context, err := resolveAttributeViewFilterContext(fixture.attrView, view, "")
		if nil != err || nil != context {
			t.Fatalf("an unscoped definition render should have no context: %#v, %v", context, err)
		}
		context, err = resolveAttributeViewFilterContext(fixture.attrView, view, "20260803091002-anchor0")
		if nil != err || nil != context {
			t.Fatalf("an ordinary block attribute panel should have no context: %#v, %v", context, err)
		}

		viewable, _, _, renderErr := RenderAttributeViewWithTarget("20260803091002-anchor0", fixture.attrView.ID,
			"", "", 1, -1, nil, av.LayoutTypeTable, false, true, "", "")
		if nil != renderErr || nil == viewable {
			t.Fatalf("rendering an ordinary block attribute panel failed: %#v, %v", viewable, renderErr)
		}
		if _, err = setAttributeViewContextFilterForTest("20260803091002-anchor0", fixture.attrView.ID, ""); nil == err {
			t.Fatal("the setter should reject an ordinary block carrier")
		}
	})

	t.Run("mismatched database block", func(t *testing.T) {
		setupDatabaseBlockTransactionTest(t, true)
		other := av.NewAttributeView("20260904005000-otherav")
		if _, err := resolveAttributeViewFilterContext(other, other.Views[0],
			"20260803091003-avblock"); nil == err {
			t.Fatal("a database block from another attribute view should fail closed")
		}
	})
}

func TestResolveAttributeViewContextFilterMapsCarrierDocument(t *testing.T) {
	fixture := setupDatabaseBlockTransactionTest(t, true)
	relationKey := &av.Key{
		ID: "relation", Type: av.KeyTypeRelation, Relation: &av.Relation{AvID: fixture.attrView.ID},
	}
	fixture.attrView.KeyValues = append(fixture.attrView.KeyValues, &av.KeyValues{Key: relationKey})
	if err := av.SaveAttributeView(fixture.attrView); nil != err {
		t.Fatal(err)
	}
	const blockID = "20260803091003-avblock"
	if _, err := setAttributeViewContextFilterForTest(blockID, fixture.attrView.ID, relationKey.ID); nil != err {
		t.Fatal(err)
	}

	context, err := resolveAttributeViewFilterContext(fixture.attrView, fixture.tableView, blockID)
	if nil != err {
		t.Fatal(err)
	}
	if nil == context || relationKey.ID != context.KeyID || 0 != len(context.CurrentDocumentItemIDs) {
		t.Fatalf("an unbound carrier document should resolve to an empty context: %#v", context)
	}
	if _, err = GetAttrViewAddingBlockDefaultValues(fixture.attrView.ID, blockID, fixture.tableView.ID,
		"", "", "new-item"); !errors.Is(err, av.ErrAttributeViewContextNotBound) {
		t.Fatalf("creating an item with an unbound context returned %v", err)
	}

	fixture.attrView.GetBlockKeyValues().Values = append(fixture.attrView.GetBlockKeyValues().Values, &av.Value{
		BlockID: "project-item", Type: av.KeyTypeBlock, Block: &av.ValueBlock{ID: fixture.tree.Root.ID},
	})
	context, err = resolveAttributeViewFilterContext(fixture.attrView, fixture.tableView, blockID)
	if nil != err {
		t.Fatal(err)
	}
	if nil == context || 1 != len(context.CurrentDocumentItemIDs) ||
		"project-item" != context.CurrentDocumentItemIDs[0] {
		t.Fatalf("unexpected bound carrier context: %#v", context)
	}
}

func TestAttributeViewContextFilterSurvivesFieldLifecycle(t *testing.T) {
	fixture := setupDatabaseBlockTransactionTest(t, true)
	const blockID = "20260803091003-avblock"
	relationKey := &av.Key{
		ID: "lifecycle-relation", Name: "Project", Type: av.KeyTypeRelation,
		Relation: &av.Relation{AvID: fixture.attrView.ID},
	}
	fixture.attrView.KeyValues = append(fixture.attrView.KeyValues, &av.KeyValues{Key: relationKey})
	blockKeyValues := fixture.attrView.GetBlockKeyValues()
	blockKeyValues.Values = append(blockKeyValues.Values, &av.Value{
		ID: ast.NewNodeID(), KeyID: blockKeyValues.Key.ID, BlockID: "project-item", Type: av.KeyTypeBlock,
		Block: &av.ValueBlock{ID: fixture.tree.Root.ID},
	})
	if err := av.SaveAttributeView(fixture.attrView); nil != err {
		t.Fatal(err)
	}
	if _, err := setAttributeViewContextFilterForTest(blockID, fixture.attrView.ID, relationKey.ID); nil != err {
		t.Fatal(err)
	}
	originalRaw := databaseBlockContextFilterRaw(t, blockID)
	assertResolvedAttributeViewContext(t, fixture.attrView, blockID, relationKey.ID, "project-item")

	if err := updateAttributeViewColumn(&Operation{
		AvID: fixture.attrView.ID, ID: relationKey.ID, Name: relationKey.Name, Typ: string(av.KeyTypeText),
	}); nil != err {
		t.Fatal(err)
	}
	current := parseAttributeViewContextFilterLifecycleTest(t, fixture.attrView.ID)
	assertPersistedAttributeViewContextFilter(t, current, blockID, relationKey.ID, originalRaw)
	emptyContext := assertResolvedAttributeViewContext(t, current, blockID, relationKey.ID)
	assertAttributeViewContextFilterRendersNoRows(t, current, emptyContext)

	if err := updateAttributeViewColumn(&Operation{
		AvID: fixture.attrView.ID, ID: relationKey.ID, Name: relationKey.Name, Typ: string(av.KeyTypeRelation),
	}); nil != err {
		t.Fatal(err)
	}
	current = parseAttributeViewContextFilterLifecycleTest(t, fixture.attrView.ID)
	assertPersistedAttributeViewContextFilter(t, current, blockID, relationKey.ID, originalRaw)
	assertResolvedAttributeViewContext(t, current, blockID, relationKey.ID, "project-item")

	currentKey, err := current.GetKey(relationKey.ID)
	if nil != err {
		t.Fatal(err)
	}
	currentKey.Relation.AvID = "20260904003000-missing"
	if err = av.SaveAttributeView(current); nil != err {
		t.Fatal(err)
	}
	assertPersistedAttributeViewContextFilter(t, current, blockID, relationKey.ID, originalRaw)
	assertResolvedAttributeViewContext(t, current, blockID, relationKey.ID)

	currentKey.Relation.AvID = current.ID
	if err = av.SaveAttributeView(current); nil != err {
		t.Fatal(err)
	}
	assertResolvedAttributeViewContext(t, current, blockID, relationKey.ID, "project-item")

	if err = RemoveAttributeViewKey(current.ID, relationKey.ID, false); nil != err {
		t.Fatal(err)
	}
	current = parseAttributeViewContextFilterLifecycleTest(t, fixture.attrView.ID)
	assertPersistedAttributeViewContextFilter(t, current, blockID, relationKey.ID, originalRaw)
	assertResolvedAttributeViewContext(t, current, blockID, relationKey.ID)

	current.KeyValues = append(current.KeyValues, &av.KeyValues{Key: &av.Key{
		ID: relationKey.ID, Name: relationKey.Name, Type: av.KeyTypeRelation,
		Relation: &av.Relation{AvID: current.ID},
	}})
	if err = av.SaveAttributeView(current); nil != err {
		t.Fatal(err)
	}
	assertPersistedAttributeViewContextFilter(t, current, blockID, relationKey.ID, originalRaw)
	assertResolvedAttributeViewContext(t, current, blockID, relationKey.ID, "project-item")

	if err = RemoveAttributeViewKey(current.ID, relationKey.ID, false); nil != err {
		t.Fatal(err)
	}
	if cleared, clearErr := setAttributeViewContextFilterForTest(blockID, current.ID, ""); nil != clearErr || nil != cleared {
		t.Fatalf("clear stale context filter failed: %#v, %v", cleared, clearErr)
	}
	current = parseAttributeViewContextFilterLifecycleTest(t, fixture.attrView.ID)
	filter, err := GetAttributeViewContextFilter(current, blockID)
	if nil != err || nil != filter || "" != databaseBlockContextFilterRaw(t, blockID) {
		t.Fatalf("stale context filter was not cleared: %#v, %v", filter, err)
	}
	context, err := resolveAttributeViewFilterContext(current, current.Views[0], blockID)
	if nil != err || nil != context {
		t.Fatalf("cleared context filter should not resolve: %#v, %v", context, err)
	}
}

func TestAttributeViewContextFilterReplayRestoresStaleConfiguration(t *testing.T) {
	fixture := setupDatabaseBlockTransactionTest(t, true)
	const blockID = "20260803091003-avblock"
	relationKey := &av.Key{
		ID: "stale-relation", Name: "Project", Type: av.KeyTypeRelation,
		Relation: &av.Relation{AvID: fixture.attrView.ID},
	}
	fixture.attrView.KeyValues = append(fixture.attrView.KeyValues, &av.KeyValues{Key: relationKey})
	if err := av.SaveAttributeView(fixture.attrView); nil != err {
		t.Fatal(err)
	}
	if _, err := setAttributeViewContextFilterForTest(blockID, fixture.attrView.ID, relationKey.ID); nil != err {
		t.Fatal(err)
	}
	if err := RemoveAttributeViewKey(fixture.attrView.ID, relationKey.ID, false); nil != err {
		t.Fatal(err)
	}
	if _, err := setAttributeViewContextFilterForTest(blockID, fixture.attrView.ID, ""); nil != err {
		t.Fatal(err)
	}
	if _, err := setAttributeViewContextFilterForTest(blockID, fixture.attrView.ID, relationKey.ID); nil == err {
		t.Fatal("a normal transaction restored an invalid stale context filter")
	}
	assertDatabaseBlockContextFilter(t, blockID, "")

	if _, err := setAttributeViewContextFilterReplayForTest(blockID, fixture.attrView.ID, relationKey.ID); nil != err {
		t.Fatal(err)
	}
	assertDatabaseBlockContextFilter(t, blockID, relationKey.ID)
	if _, err := setAttributeViewContextFilterReplayForTest(blockID, fixture.attrView.ID, ""); nil != err {
		t.Fatal(err)
	}
	assertDatabaseBlockContextFilter(t, blockID, "")
}

func TestAttributeViewContextFilterRejectsMalformedLifecycleMetadata(t *testing.T) {
	fixture := setupDatabaseBlockTransactionTest(t, true)
	const blockID = "20260803091003-avblock"
	for _, test := range []struct {
		name string
		raw  string
	}{
		{name: "malformed", raw: `{`},
		{name: "unknown spec", raw: `{"spec":2,"keyID":"relation"}`},
	} {
		t.Run(test.name, func(t *testing.T) {
			setDatabaseBlockContextFilterRawForTest(t, blockID, test.raw)
			if _, err := GetAttributeViewContextFilter(fixture.attrView, blockID); !errors.Is(err, av.ErrInvalidAttributeViewContextFilter) {
				t.Fatalf("invalid metadata returned %v", err)
			}
			if _, err := resolveAttributeViewFilterContext(fixture.attrView, fixture.tableView,
				blockID); !errors.Is(err, av.ErrInvalidAttributeViewContextFilter) {
				t.Fatalf("resolving invalid metadata returned %v", err)
			}
		})
	}
}

func parseAttributeViewContextFilterLifecycleTest(t *testing.T, avID string) *av.AttributeView {
	t.Helper()
	attrView, err := av.ParseAttributeView(avID)
	if nil != err {
		t.Fatal(err)
	}
	return attrView
}

func assertPersistedAttributeViewContextFilter(t *testing.T, attrView *av.AttributeView, blockID, keyID, raw string) {
	t.Helper()
	filter, err := GetAttributeViewContextFilter(attrView, blockID)
	if nil != err {
		t.Fatal(err)
	}
	if nil == filter || keyID != filter.KeyID || raw != databaseBlockContextFilterRaw(t, blockID) {
		t.Fatalf("unexpected persisted lifecycle metadata: %#v, %q", filter, databaseBlockContextFilterRaw(t, blockID))
	}
}

func assertResolvedAttributeViewContext(t *testing.T, attrView *av.AttributeView, blockID, keyID string,
	wantItemIDs ...string) *av.FilterContext {
	t.Helper()
	context, err := resolveAttributeViewFilterContext(attrView, attrView.Views[0], blockID)
	if nil != err {
		t.Fatal(err)
	}
	if nil == context || keyID != context.KeyID || len(wantItemIDs) != len(context.CurrentDocumentItemIDs) {
		t.Fatalf("unexpected resolved lifecycle context: %#v", context)
	}
	for i, want := range wantItemIDs {
		if want != context.CurrentDocumentItemIDs[i] {
			t.Fatalf("unexpected context item at %d: got %s, want %s", i, context.CurrentDocumentItemIDs[i], want)
		}
	}
	return context
}

func assertAttributeViewContextFilterRendersNoRows(t *testing.T, attrView *av.AttributeView, context *av.FilterContext) {
	t.Helper()
	view := attrView.Views[0]
	table := &av.Table{
		BaseInstance: av.NewViewBaseInstance(view),
		Rows:         []*av.TableRow{{ID: "otherwise-visible"}},
	}
	if _, _, err := renderViewableInstance(table, view, attrView, 1, 10, false, "",
		sql.NewAttributeViewRenderContext(), context); nil != err {
		t.Fatal(err)
	}
	if 0 != len(table.GetItems()) {
		t.Fatalf("stale context rendered rows: %#v", table.GetItems())
	}
}

func databaseBlockContextFilterRaw(t *testing.T, blockID string) string {
	t.Helper()
	node, _, err := getNodeByBlockID(nil, blockID)
	if nil != err {
		t.Fatal(err)
	}
	return node.IALAttr(av.NodeAttrContextFilter)
}

func setDatabaseBlockContextFilterRawForTest(t *testing.T, blockID, raw string) {
	t.Helper()
	node, tree, err := getNodeByBlockID(nil, blockID)
	if nil != err {
		t.Fatal(err)
	}
	node.SetIALAttr(av.NodeAttrContextFilter, raw)
	if _, err = filesys.WriteTree(tree); nil != err {
		t.Fatal(err)
	}
	treenode.UpsertBlockTree(tree)
}

func assertDatabaseBlockContextFilter(t *testing.T, blockID, expectedKeyID string) {
	t.Helper()
	node, _, err := getNodeByBlockID(nil, blockID)
	if nil != err {
		t.Fatal(err)
	}
	raw := node.IALAttr(av.NodeAttrContextFilter)
	if "" == expectedKeyID {
		if "" != raw {
			t.Fatalf("context filter attribute should be absent, got %q", raw)
		}
		return
	}
	filter, err := av.ParseAttributeViewContextFilter(raw)
	if nil != err {
		t.Fatal(err)
	}
	if nil == filter || av.AttributeViewContextFilterSpec != filter.Spec || expectedKeyID != filter.KeyID {
		t.Fatalf("unexpected persisted context filter: %#v", filter)
	}
}

func setAttributeViewContextFilterForTest(blockID, avID, keyID string) (*av.AttributeViewContextFilter, error) {
	return setAttributeViewContextFilterWithReplayForTest(blockID, avID, keyID, false)
}

func setAttributeViewContextFilterReplayForTest(blockID, avID, keyID string) (*av.AttributeViewContextFilter, error) {
	return setAttributeViewContextFilterWithReplayForTest(blockID, avID, keyID, true)
}

func setAttributeViewContextFilterWithReplayForTest(blockID, avID, keyID string,
	replay bool) (*av.AttributeViewContextFilter, error) {
	tx := &Transaction{trees: map[string]*parse.Tree{}, isReplay: replay}
	filter, err := setAttributeViewContextFilter(tx, blockID, avID, keyID)
	if nil != err {
		return nil, err
	}
	for _, tree := range tx.trees {
		if _, err = filesys.WriteTree(tree); nil != err {
			return nil, err
		}
		treenode.UpsertBlockTree(tree)
	}
	return filter, nil
}
