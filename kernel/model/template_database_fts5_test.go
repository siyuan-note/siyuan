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

//go:build fts5

package model

import (
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/treenode"
)

func TestApplyTemplateDatabaseReferenceRegistersMirrors(t *testing.T) {
	fixture := setupTemplateDocTreeTransactionTest(t)
	database := addTemplateAttributeViewTestFixture(t, fixture, "20260904000300-avtmpl4")
	code, err := DocSaveAsTemplateWithDatabaseMode(fixture.sourceID, "reference-mirror", false,
		TemplateDatabaseModeReference)
	if nil != err || 0 != code {
		t.Fatalf("save reference template failed: code=%d, err=%v", code, err)
	}

	if err = applyDocContentTemplate("reference-mirror.md", fixture.targetID); nil != err {
		t.Fatalf("apply reference content template failed: %v", err)
	}
	targetTree, err := LoadTreeByBlockID(fixture.targetID)
	if nil != err {
		t.Fatalf("load target tree failed: %v", err)
	}
	targetNodes := targetTree.Root.ChildrenByType(ast.NodeAttributeView)
	if 2 != len(targetNodes) {
		t.Fatalf("unexpected applied database block count: %d", len(targetNodes))
	}
	mirrors := treenode.GetMirrorAttrViewBlockIDs(database.attrView.ID)
	for _, node := range targetNodes {
		if !containsString(mirrors, node.ID) {
			t.Fatalf("applied reference block [%s] was not registered as a mirror", node.ID)
		}
	}
}

func TestCreateAttributeViewItemMergesTemplateAndContextRelations(t *testing.T) {
	fixture := setupTemplateDocTreeTransactionTest(t)
	database := addTemplateAttributeViewTestFixture(t, fixture, ast.NewNodeID())
	blockID := database.nodes[0].ID

	target := av.NewAttributeView(ast.NewNodeID())
	relationKey := av.NewKey(ast.NewNodeID(), "Project", "", av.KeyTypeRelation)
	backRelationKey := av.NewKey(ast.NewNodeID(), "Tasks", "", av.KeyTypeRelation)
	relationKey.Relation = &av.Relation{
		AvID: target.ID, IsTwoWay: true, BackKeyID: backRelationKey.ID,
	}
	backRelationKey.Relation = &av.Relation{
		AvID: database.attrView.ID, IsTwoWay: true, BackKeyID: relationKey.ID,
	}
	database.attrView.KeyValues = append(database.attrView.KeyValues, &av.KeyValues{Key: relationKey})
	target.KeyValues = append(target.KeyValues, &av.KeyValues{Key: backRelationKey})

	currentProjectID := ast.NewNodeID()
	staticProjectID := ast.NewNodeID()
	target.GetBlockKeyValues().Values = append(target.GetBlockKeyValues().Values,
		&av.Value{
			ID: ast.NewNodeID(), KeyID: target.GetBlockKey().ID, BlockID: currentProjectID, Type: av.KeyTypeBlock,
			Block: &av.ValueBlock{ID: fixture.sourceID, Content: "Current project"},
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
	if err := database.attrView.SetNewItemTemplates(&av.NewItemTemplatesConfig{Templates: []*av.NewItemTemplate{{
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
	if err := av.SaveAttributeView(database.attrView); nil != err {
		t.Fatal(err)
	}
	if _, err := setAttributeViewContextFilterForTest(blockID, database.attrView.ID, relationKey.ID); nil != err {
		t.Fatal(err)
	}

	created, err := CreateAttributeViewItem(database.attrView.ID, blockID, database.attrView.Views[0].ID,
		templateID, "", "")
	if nil != err {
		t.Fatal(err)
	}
	updated, err := av.ParseAttributeView(database.attrView.ID)
	if nil != err {
		t.Fatal(err)
	}
	assertContextFilterRelationIDs(t, updated.GetValue(relationKey.ID, created.ItemID),
		staticProjectID, currentProjectID)

	updatedTarget, err := av.ParseAttributeView(target.ID)
	if nil != err {
		t.Fatal(err)
	}
	assertContextFilterRelationIDs(t, updatedTarget.GetValue(backRelationKey.ID, staticProjectID), created.ItemID)
	assertContextFilterRelationIDs(t, updatedTarget.GetValue(backRelationKey.ID, currentProjectID), created.ItemID)

	if err = removeAttributeViewBlock([]string{created.ItemID}, database.attrView.ID, blockID, nil); nil != err {
		t.Fatal(err)
	}
	updated, err = av.ParseAttributeView(database.attrView.ID)
	if nil != err {
		t.Fatal(err)
	}
	if value := updated.GetValue(relationKey.ID, created.ItemID); nil != value {
		t.Fatalf("removed item retained its source relation value: %#v", value)
	}
	updatedTarget, err = av.ParseAttributeView(target.ID)
	if nil != err {
		t.Fatal(err)
	}
	assertContextFilterRelationIDs(t, updatedTarget.GetValue(backRelationKey.ID, staticProjectID))
	assertContextFilterRelationIDs(t, updatedTarget.GetValue(backRelationKey.ID, currentProjectID))
}

func TestRemoveAttributeViewItemAllowsMissingTwoWayTarget(t *testing.T) {
	fixture := setupTemplateDocTreeTransactionTest(t)
	database := addTemplateAttributeViewTestFixture(t, fixture, ast.NewNodeID())
	blockID := database.nodes[0].ID
	itemID := ast.NewNodeID()
	relationKey := av.NewKey(ast.NewNodeID(), "Missing", "", av.KeyTypeRelation)
	relationKey.Relation = &av.Relation{
		AvID: ast.NewNodeID(), IsTwoWay: true, BackKeyID: ast.NewNodeID(),
	}
	database.attrView.KeyValues = append(database.attrView.KeyValues, &av.KeyValues{
		Key: relationKey,
		Values: []*av.Value{{
			ID: ast.NewNodeID(), KeyID: relationKey.ID, BlockID: itemID, Type: av.KeyTypeRelation,
			Relation: &av.ValueRelation{BlockIDs: []string{ast.NewNodeID()}},
		}},
	})
	database.attrView.GetBlockKeyValues().Values = append(database.attrView.GetBlockKeyValues().Values, &av.Value{
		ID: ast.NewNodeID(), KeyID: database.attrView.GetBlockKey().ID, BlockID: itemID, Type: av.KeyTypeBlock,
		IsDetached: true, Block: &av.ValueBlock{Content: "Stale relation"},
	})
	for _, view := range database.attrView.Views {
		view.ItemIDs = append(view.ItemIDs, itemID)
	}
	if err := av.SaveAttributeView(database.attrView); nil != err {
		t.Fatal(err)
	}

	if err := removeAttributeViewBlock([]string{itemID}, database.attrView.ID, blockID, nil); nil != err {
		t.Fatal(err)
	}
	updated, err := av.ParseAttributeView(database.attrView.ID)
	if nil != err {
		t.Fatal(err)
	}
	if nil != updated.GetValue(database.attrView.GetBlockKey().ID, itemID) ||
		nil != updated.GetValue(relationKey.ID, itemID) {
		t.Fatal("item with a missing two-way target was not removed")
	}
}
