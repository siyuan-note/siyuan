//go:build fts5

package model

import (
	"slices"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestCreateAttributeViewItemPreservesFilteredGroups(t *testing.T) {
	for _, layout := range []av.LayoutType{av.LayoutTypeTable, av.LayoutTypeList, av.LayoutTypeGallery, av.LayoutTypeKanban} {
		for _, target := range []av.NewItemTargetType{av.NewItemTargetDetached, av.NewItemTargetDocument} {
			t.Run(string(layout)+"/"+string(target), func(t *testing.T) {
				fixture := setupTemplateDocTreeTransactionTest(t)
				database := addTemplateAttributeViewTestFixture(t, fixture, ast.NewNodeID())
				util.AttrViewLangs["en"]["list"] = "List"
				util.AttrViewLangs["en"]["kanban"] = "Kanban"
				attrView := database.attrView
				view := attrView.Views[0]
				if err := changeAttrViewLayout(attrView, view, layout); err != nil {
					t.Fatal(err)
				}
				filterKey := av.NewKey(ast.NewNodeID(), "View", "", av.KeyTypeMSelect)
				filterKey.Options = []*av.SelectOption{{Name: "Feedback", Color: "1"}}
				seedID := view.ItemIDs[0]
				attrView.KeyValues = append(attrView.KeyValues, &av.KeyValues{
					Key: filterKey,
					Values: []*av.Value{{
						ID: ast.NewNodeID(), KeyID: filterKey.ID, BlockID: seedID, Type: av.KeyTypeMSelect,
						MSelect: []*av.ValueSelect{{Content: "Feedback", Color: "1"}},
					}},
				})
				if layout == av.LayoutTypeTable || layout == av.LayoutTypeList {
					view.GetTableLayout().Columns = append(view.GetTableLayout().Columns,
						&av.ViewTableColumn{BaseField: &av.BaseField{ID: filterKey.ID}})
				} else if layout == av.LayoutTypeGallery {
					view.Gallery.CardFields = append(view.Gallery.CardFields,
						&av.ViewGalleryCardField{BaseField: &av.BaseField{ID: filterKey.ID}})
				} else {
					view.Kanban.Fields = append(view.Kanban.Fields,
						&av.ViewKanbanField{BaseField: &av.BaseField{ID: filterKey.ID}})
				}
				view.Filters = []*av.ViewFilter{{Combination: av.FilterCombinationAnd, Filters: []*av.ViewFilter{{
					Column: filterKey.ID, Operator: av.FilterOperatorContains,
					Value: &av.Value{Type: av.KeyTypeMSelect, MSelect: []*av.ValueSelect{{Content: "Feedback", Color: "1"}}},
				}}}}
				setAttributeViewGroup(attrView, view, &av.ViewGroup{
					Field: attrView.KeyValues[1].Key.ID, Method: av.GroupMethodValue, HideEmpty: true,
				})
				group := view.GetGroupByGroupValue(groupValueDefault)
				if group == nil {
					t.Fatal("seed item has no blank group")
				}
				group.GroupFolded = layout != av.LayoutTypeKanban
				groupID := group.ID
				template := &av.NewItemTemplate{
					ID: ast.NewNodeID(), Name: "Entry", TargetType: target, HideInFileTree: target == av.NewItemTargetDocument,
				}
				attrView.NewItemTemplates = []*av.NewItemTemplate{template}
				if err := av.SaveAttributeView(attrView); err != nil {
					t.Fatal(err)
				}

				created, err := CreateAttributeViewItem(attrView.ID, database.nodes[0].ID, view.ID, template.ID, "", "")
				if err != nil {
					t.Fatal(err)
				}
				stored := readAttributeViewItemsTest(t, attrView.ID)
				value := stored.GetValue(filterKey.ID, created.ItemID)
				if value == nil || !av.MSelectExistOption(value.MSelect, "Feedback") {
					t.Fatalf("new item did not inherit the filter value: %+v", value)
				}
				storedGroup := stored.GetView(view.ID).GetGroupByGroupValue(groupValueDefault)
				if storedGroup == nil || !slices.Contains(storedGroup.GroupItemIDs, created.ItemID) {
					t.Fatalf("new item is missing from its persisted group: %+v", storedGroup)
				}
				if storedGroup.ID != groupID || storedGroup.GroupFolded != (layout != av.LayoutTypeKanban) ||
					!slices.Contains(storedGroup.GroupItemIDs, seedID) {
					t.Fatalf("existing group identity, fold state or items changed: %+v", storedGroup)
				}
				statuses, err := GetAttributeViewItemStatuses(database.nodes[0].ID, attrView.ID, view.ID, "", []string{created.ItemID})
				if err != nil || statuses[created.ItemID] != "visible" {
					t.Fatalf("matching new item should be visible: statuses=%v, err=%v", statuses, err)
				}
				groupCreated, err := CreateAttributeViewItem(attrView.ID, database.nodes[0].ID, view.ID, template.ID,
					created.ItemID, groupID)
				if err != nil {
					t.Fatal(err)
				}
				stored = readAttributeViewItemsTest(t, attrView.ID)
				storedGroup = stored.GetView(view.ID).GetGroupByID(groupID)
				if storedGroup == nil || !slices.Contains(storedGroup.GroupItemIDs, groupCreated.ItemID) {
					t.Fatalf("item created inside a group is missing: %+v", storedGroup)
				}
				statuses, err = GetAttributeViewItemStatuses(database.nodes[0].ID, attrView.ID, view.ID, "",
					[]string{created.ItemID, groupCreated.ItemID})
				if err != nil || statuses[created.ItemID] != "visible" || statuses[groupCreated.ItemID] != "visible" {
					t.Fatalf("matching items should remain visible after group insertion: statuses=%v, err=%v", statuses, err)
				}
				storedGroup.GroupHidden = 2
				if err = av.SaveAttributeView(stored); err != nil {
					t.Fatal(err)
				}
				statuses, err = GetAttributeViewItemStatuses(database.nodes[0].ID, attrView.ID, view.ID, "", []string{created.ItemID})
				if err != nil || statuses[created.ItemID] != "groupHidden" {
					t.Fatalf("manually hidden groups should remain hidden: statuses=%v, err=%v", statuses, err)
				}
				stored.GetValue(filterKey.ID, created.ItemID).MSelect = nil
				if err = av.SaveAttributeView(stored); err != nil {
					t.Fatal(err)
				}
				statuses, err = GetAttributeViewItemStatuses(database.nodes[0].ID, attrView.ID, view.ID, "", []string{created.ItemID})
				if err != nil || statuses[created.ItemID] != "filtered" {
					t.Fatalf("nonmatching items should remain filtered: statuses=%v, err=%v", statuses, err)
				}
			})
		}
	}
}
