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
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAttributeViewCarrierUsesExactCryptoBoundary(t *testing.T) {
	fixture := setupDatabaseBlockTransactionTest(t, true)
	const (
		carrierBlockID = "20260803091003-avblock"
		foreignBoxID   = "20260904120000-boxenc0"
		foreignAvID    = "20260904120001-avenc00"
	)

	oldEncryptedBoxIDs := av.AVEncryptedBoxIDs
	av.AVEncryptedBoxIDs = func() []string { return []string{foreignBoxID} }
	t.Cleanup(func() { av.AVEncryptedBoxIDs = oldEncryptedBoxIDs })

	foreignPath := filepath.Join(util.DataDir, foreignBoxID, "storage", "av", foreignAvID+".json")
	if err := os.MkdirAll(filepath.Dir(foreignPath), 0755); nil != err {
		t.Fatal(err)
	}
	if err := os.WriteFile(foreignPath, []byte("foreign encrypted attribute view"), 0644); nil != err {
		t.Fatal(err)
	}
	if path, boxID := av.FindAttributeViewPath(foreignAvID); path != foreignPath || boxID != foreignBoxID {
		t.Fatalf("foreign attribute view fallback precondition failed: %q, %q", path, boxID)
	}

	parsed, err := avParseView(fixture.attrView.ID, carrierBlockID)
	if nil != err || nil == parsed || parsed.ID != fixture.attrView.ID {
		t.Fatalf("ordinary carrier did not load its global attribute view: %+v, %v", parsed, err)
	}
	if _, err = avParseView(foreignAvID, carrierBlockID); !errors.Is(err, av.ErrViewNotFound) {
		t.Fatalf("ordinary carrier should not parse an encrypted attribute view through fallback: %v", err)
	}
	if _, err = avParseView(fixture.attrView.ID, "20260904120002-missing"); nil == err ||
		!strings.Contains(err.Error(), "carrier") {
		t.Fatalf("a supplied but missing carrier should fail closed: %v", err)
	}

	if _, err = GetCurrentAttributeViewImages(nil, foreignAvID, carrierBlockID, "", ""); !errors.Is(err, av.ErrViewNotFound) {
		t.Fatalf("image lookup should preserve the carrier crypto boundary: %v", err)
	}
	if _, _, _, err = RenderAttributeViewWithTarget(carrierBlockID, foreignAvID, "", "", 1, -1, nil,
		av.LayoutTypeTable, false, false, "", ""); !errors.Is(err, av.ErrAttributeViewNotFound) {
		t.Fatalf("render should reject a foreign attribute view: %v", err)
	}
	if _, _, _, err = RenderAttributeViewWithTarget(carrierBlockID, foreignAvID, "", "", 1, -1, nil,
		av.LayoutTypeTable, true, false, "", ""); !errors.Is(err, av.ErrAttributeViewNotFound) {
		t.Fatalf("render should not create a cross-boundary duplicate attribute view: %v", err)
	}
	if _, statErr := os.Stat(av.GetAttributeViewDataPath(foreignAvID)); !os.IsNotExist(statErr) {
		t.Fatalf("cross-boundary render unexpectedly created a global attribute view: %v", statErr)
	}

	relationKey := &av.Key{
		ID: "foreign-relation", Type: av.KeyTypeRelation, Relation: &av.Relation{AvID: foreignAvID},
	}
	fixture.attrView.KeyValues = append(fixture.attrView.KeyValues, &av.KeyValues{Key: relationKey})
	contextFilter := &av.AttributeViewContextFilter{Spec: av.AttributeViewContextFilterSpec, KeyID: relationKey.ID}
	contextFilterJSON, marshalErr := contextFilter.Marshal()
	if nil != marshalErr {
		t.Fatal(marshalErr)
	}
	carrierNode := treenode.GetNodeInTree(fixture.tree, carrierBlockID)
	carrierNode.SetIALAttr(av.NodeAttrContextFilter, contextFilterJSON)
	if _, writeErr := filesys.WriteTree(fixture.tree); nil != writeErr {
		t.Fatal(writeErr)
	}
	treenode.UpsertBlockTree(fixture.tree)
	context, contextErr := resolveAttributeViewFilterContext(fixture.attrView, fixture.tableView, carrierBlockID)
	if nil != contextErr || nil == context || relationKey.ID != context.KeyID ||
		0 != len(context.CurrentDocumentItemIDs) {
		t.Fatalf("cross-boundary context target should fail closed with no matched items: %#v, %v", context, contextErr)
	}
}

func TestTwoWayRelationWriteUsesCarrierCryptoBoundary(t *testing.T) {
	fixture := setupDatabaseBlockTransactionTest(t, true)
	const (
		carrierBlockID = "20260803091003-avblock"
		foreignBoxID   = "20260904122000-boxenc1"
		sharedAvID     = "20260904122001-shared0"
		targetItemID   = "20260904122002-target0"
		sourceItemID   = "20260904122003-source0"
	)

	oldEncryptedBoxIDs := av.AVEncryptedBoxIDs
	av.AVEncryptedBoxIDs = func() []string { return []string{foreignBoxID} }
	t.Cleanup(func() {
		av.AVEncryptedBoxIDs = oldEncryptedBoxIDs
		av.SetAVBoxID(sharedAvID, "")
	})

	backRelationKey := av.NewKey(ast.NewNodeID(), "Tasks", "", av.KeyTypeRelation)
	globalTarget := av.NewAttributeView(sharedAvID)
	globalTarget.KeyValues = append(globalTarget.KeyValues, &av.KeyValues{Key: backRelationKey})
	globalTarget.GetBlockKeyValues().Values = append(globalTarget.GetBlockKeyValues().Values, &av.Value{
		ID: ast.NewNodeID(), KeyID: globalTarget.GetBlockKey().ID, BlockID: targetItemID, Type: av.KeyTypeBlock,
		IsDetached: true, Block: &av.ValueBlock{Content: "Global target"},
	})
	globalTarget.Views[0].ItemIDs = append(globalTarget.Views[0].ItemIDs, targetItemID)
	av.SetAVBoxID(sharedAvID, "")
	if err := av.SaveAttributeView(globalTarget); nil != err {
		t.Fatal(err)
	}

	foreignPath := filepath.Join(util.DataDir, foreignBoxID, "storage", "av", sharedAvID+".json")
	if err := os.MkdirAll(filepath.Dir(foreignPath), 0755); nil != err {
		t.Fatal(err)
	}
	const foreignData = "foreign encrypted attribute view"
	if err := os.WriteFile(foreignPath, []byte(foreignData), 0644); nil != err {
		t.Fatal(err)
	}
	av.SetAVBoxID(sharedAvID, foreignBoxID)

	relationKey := av.NewKey(ast.NewNodeID(), "Project", "", av.KeyTypeRelation)
	relationKey.Relation = &av.Relation{
		AvID: sharedAvID, IsTwoWay: true, BackKeyID: backRelationKey.ID,
	}
	fixture.attrView.KeyValues = append(fixture.attrView.KeyValues, &av.KeyValues{Key: relationKey})
	fixture.attrView.GetBlockKeyValues().Values = append(fixture.attrView.GetBlockKeyValues().Values, &av.Value{
		ID: ast.NewNodeID(), KeyID: fixture.attrView.GetBlockKey().ID, BlockID: sourceItemID, Type: av.KeyTypeBlock,
		IsDetached: true, Block: &av.ValueBlock{Content: "Source item"},
	})
	fixture.attrView.Views[0].ItemIDs = append(fixture.attrView.Views[0].ItemIDs, sourceItemID)
	if err := av.SaveAttributeView(fixture.attrView); nil != err {
		t.Fatal(err)
	}

	if _, err := updateAttributeViewCellInBlock(nil, fixture.attrView.ID, carrierBlockID, relationKey.ID,
		sourceItemID, &av.Value{Type: av.KeyTypeRelation, Relation: &av.ValueRelation{
			BlockIDs: []string{targetItemID},
		}}); nil != err {
		t.Fatal(err)
	}
	updatedTarget, err := av.ParseAttributeViewInBox(sharedAvID, "")
	if nil != err {
		t.Fatal(err)
	}
	assertContextFilterRelationIDs(t, updatedTarget.GetValue(backRelationKey.ID, targetItemID), sourceItemID)
	data, err := os.ReadFile(foreignPath)
	if nil != err {
		t.Fatal(err)
	}
	if foreignData != string(data) {
		t.Fatalf("foreign same-ID attribute view was overwritten: %q", data)
	}
}
