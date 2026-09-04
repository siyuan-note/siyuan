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
	"bytes"
	"reflect"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/emirpasic/gods/sets/hashset"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestGetAttrViewTableAligns(t *testing.T) {
	table := &av.Table{Columns: []*av.TableColumn{
		{BaseInstanceField: &av.BaseInstanceField{ID: "default"}},
		{BaseInstanceField: &av.BaseInstanceField{ID: "left"}, Align: av.TableColumnAlignLeft},
		{BaseInstanceField: &av.BaseInstanceField{ID: "center"}, Align: av.TableColumnAlignCenter},
		{BaseInstanceField: &av.BaseInstanceField{ID: "right"}, Align: av.TableColumnAlignRight},
		{BaseInstanceField: &av.BaseInstanceField{ID: "hidden", Hidden: true}, Align: av.TableColumnAlignRight},
	}}

	if actual, expected := getAttrViewTableAligns(table, false), []int{0, 1, 2, 3, 3}; !reflect.DeepEqual(actual, expected) {
		t.Fatalf("expected table aligns %v, got %v", expected, actual)
	}
	if actual, expected := getAttrViewTableAligns(table, true), []int{0, 1, 2, 3}; !reflect.DeepEqual(actual, expected) {
		t.Fatalf("expected visible table aligns %v, got %v", expected, actual)
	}
}

func TestGetAttrViewCSVRenderedValue(t *testing.T) {
	const keyID = "rendered"
	table := &av.Table{Columns: []*av.TableColumn{{BaseInstanceField: &av.BaseInstanceField{
		ID: keyID, RenderTemplate: ".action{.Value}",
	}}}}
	value := &av.Value{KeyID: keyID, Type: av.KeyTypeText, Text: &av.ValueText{Content: "stored"}}

	if actual, ok := getAttrViewCSVRenderedValue(table, value); !ok || "" != actual {
		t.Fatalf("empty rendered content should not fall back to the stored value: %q, %v", actual, ok)
	}
	value.RenderedContent = "rendered"
	if actual, ok := getAttrViewCSVRenderedValue(table, value); !ok || "rendered" != actual {
		t.Fatalf("unexpected rendered CSV value: %q, %v", actual, ok)
	}
	table.Columns[0].RenderTemplate = ""
	if _, ok := getAttrViewCSVRenderedValue(table, value); ok {
		t.Fatal("a field without a display template should use its stored CSV formatting")
	}
}

func TestAttributeViewExportDoesNotCrossEncryptedBoundary(t *testing.T) {
	const (
		normalBoxID    = "20260904010000-box0001"
		docID          = "20260904010001-doc0001"
		blockID        = "20260904010002-avnode1"
		encryptedBoxID = "20260904010003-box0002"
		encryptedAvID  = "20260904010004-av00001"
		otherAvID      = "20260904010005-av00002"
		directAvID     = "20260904010006-av00003"
		middleAvID     = "20260904010007-av00004"
		recursiveAvID  = "20260904010008-av00005"
	)

	setupExportRelatedTest(t, normalBoxID)
	Conf.Editor = conf.NewEditor()
	oldLang, oldAttrViewLangs := util.Lang, util.AttrViewLangs
	util.Lang = "en"
	util.AttrViewLangs = map[string]map[string]any{
		"en": {"key": "Key", "select": "Select", "table": "Table", "gallery": "Gallery"},
	}
	markRuntimeEncryptedBox(encryptedBoxID)
	setDEKForTest(encryptedBoxID, bytes.Repeat([]byte{0x42}, 32))
	t.Cleanup(func() {
		util.Lang, util.AttrViewLangs = oldLang, oldAttrViewLangs
		av.SetAVBoxID(encryptedAvID, "")
		cachedDEKsLock.Lock()
		delete(cachedDEKs, encryptedBoxID)
		cachedDEKsLock.Unlock()
		forgetRuntimeEncryptedBox(encryptedBoxID)
	})

	attrView := av.NewAttributeView(encryptedAvID)
	av.SetAVBoxID(encryptedAvID, encryptedBoxID)
	if err := av.SaveAttributeView(attrView); nil != err {
		t.Fatalf("save encrypted attribute view failed: %v", err)
	}
	if parsed, err := av.ParseAttributeView(encryptedAvID); nil != err || nil == parsed {
		t.Fatalf("fallback precondition failed: parsed=%v, err=%v", parsed, err)
	}

	tree := treenode.NewTree(normalBoxID, "/"+docID+".sy", "/Export", "Export")
	for nil != tree.Root.FirstChild {
		tree.Root.FirstChild.Unlink()
	}
	database := &ast.Node{
		Type: ast.NodeAttributeView, ID: blockID, AttributeViewID: encryptedAvID,
		AttributeViewType: string(av.LayoutTypeTable),
	}
	database.SetIALAttr("id", blockID)
	database.SetIALAttr(av.NodeAttrView, attrView.Views[0].ID)
	tree.Root.AppendChild(database)
	writeExportRelatedTestTree(t, tree)

	if _, err := ExportAv2CSV(otherAvID, blockID); nil == err {
		t.Fatal("CSV export accepted an attribute view ID that is not bound to the database block")
	}
	if _, err := ExportAv2CSV(encryptedAvID, blockID); nil == err {
		t.Fatal("CSV export crossed from a normal document to an encrypted attribute view")
	}

	exported := exportTree(tree, false, false, true, 0, 0, 0, "", "", "", "", false, "", false, false, false)
	if nodes := exported.Root.ChildrenByType(ast.NodeAttributeView); 1 != len(nodes) {
		t.Fatal("document export resolved an encrypted attribute view from a normal document")
	}

	newRelationAttributeView := func(id, targetID string) *av.AttributeView {
		ret := av.NewAttributeView(id)
		ret.KeyValues = append(ret.KeyValues, &av.KeyValues{Key: &av.Key{
			ID: ast.NewNodeID(), Type: av.KeyTypeRelation, Relation: &av.Relation{AvID: targetID},
		}})
		return ret
	}
	for _, relationAv := range []*av.AttributeView{
		newRelationAttributeView(directAvID, encryptedAvID),
		newRelationAttributeView(middleAvID, encryptedAvID),
		newRelationAttributeView(recursiveAvID, middleAvID),
	} {
		if err := av.SaveAttributeView(relationAv); nil != err {
			t.Fatalf("save relation attribute view [%s] failed: %v", relationAv.ID, err)
		}
	}

	directIDs := hashset.New()
	walkRelationAvs(directAvID, "", directIDs)
	if !directIDs.Contains(directAvID) || directIDs.Contains(encryptedAvID) {
		t.Fatalf("direct relation export crossed the encrypted boundary: %v", directIDs.Values())
	}
	recursiveIDs := hashset.New()
	walkRelationAvs(recursiveAvID, "", recursiveIDs)
	if !recursiveIDs.Contains(recursiveAvID) || !recursiveIDs.Contains(middleAvID) ||
		recursiveIDs.Contains(encryptedAvID) {
		t.Fatalf("recursive relation export crossed the encrypted boundary: %v", recursiveIDs.Values())
	}
}
