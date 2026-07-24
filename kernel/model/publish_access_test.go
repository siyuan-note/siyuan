// SiYuan - Refactor your thinking
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
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestCheckBlockTreeAccessableByPublishAccess(t *testing.T) {
	const (
		boxID             = "20260721000000-boxid01"
		docID             = "20260721000001-docid01"
		protectedPassword = "password"
	)
	bt := &treenode.BlockTree{
		ID:    docID,
		BoxID: boxID,
		Path:  "/" + docID + ".sy",
	}
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodGet, "/", nil)

	if checkBlockTreeAccessableByPublishAccess(c, PublishAccess{{ID: docID, Disable: true}}, bt) {
		t.Fatal("publish-disabled document should not be accessible")
	}

	protectedAccess := PublishAccess{{ID: docID, Visible: true, Password: protectedPassword}}
	if checkBlockTreeAccessableByPublishAccess(c, protectedAccess, bt) {
		t.Fatal("password-protected document should not be accessible without authorization")
	}

	c.Request.AddCookie(&http.Cookie{
		Name:  "publish-auth-" + docID,
		Value: util.SHA256Hash([]byte(docID + protectedPassword)),
	})
	if !checkBlockTreeAccessableByPublishAccess(c, protectedAccess, bt) {
		t.Fatal("password-protected document should be accessible after authorization")
	}

	if !checkBlockTreeAccessableByPublishAccess(c, PublishAccess{{ID: docID, Visible: false}}, bt) {
		t.Fatal("hidden document should remain directly accessible")
	}
}

func TestCheckBlockTreeMetadataAccessableByPublishAccess(t *testing.T) {
	const (
		boxID          = "20260725000000-boxid01"
		docID          = "20260725000001-docid01"
		parentID       = "20260725000002-parent1"
		privateID      = "20260725000003-private"
		privatePass    = "password"
		protectedID    = "20260725000004-protect"
		protectedPass  = "protected-password"
		inconsistentID = "20260725000005-invalid"
		childID        = "20260725000006-child01"
	)
	newBlockTree := func(id, blockPath string) *treenode.BlockTree {
		return &treenode.BlockTree{
			ID:    id,
			BoxID: boxID,
			Path:  blockPath,
		}
	}
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodGet, "/", nil)

	tests := []struct {
		name          string
		publishAccess PublishAccess
		blockTree     *treenode.BlockTree
		metadata      bool
		discoverable  bool
	}{
		{
			name:         "missing",
			blockTree:    nil,
			metadata:     false,
			discoverable: false,
		},
		{
			name:         "public",
			blockTree:    newBlockTree(docID, "/"+docID+".sy"),
			metadata:     true,
			discoverable: true,
		},
		{
			name:          "protected",
			publishAccess: PublishAccess{{ID: protectedID, Visible: true, Password: protectedPass}},
			blockTree:     newBlockTree(protectedID, "/"+protectedID+".sy"),
			metadata:      true,
			discoverable:  true,
		},
		{
			name:          "hidden",
			publishAccess: PublishAccess{{ID: docID, Visible: false}},
			blockTree:     newBlockTree(docID, "/"+docID+".sy"),
			metadata:      true,
			discoverable:  false,
		},
		{
			name:          "private",
			publishAccess: PublishAccess{{ID: privateID, Visible: false, Password: privatePass}},
			blockTree:     newBlockTree(privateID, "/"+privateID+".sy"),
			metadata:      false,
			discoverable:  false,
		},
		{
			name:          "forbidden",
			publishAccess: PublishAccess{{ID: docID, Visible: false, Disable: true}},
			blockTree:     newBlockTree(docID, "/"+docID+".sy"),
			metadata:      false,
			discoverable:  false,
		},
		{
			name:          "hidden parent",
			publishAccess: PublishAccess{{ID: parentID, Visible: false}},
			blockTree:     newBlockTree(docID, "/"+parentID+"/"+docID+".sy"),
			metadata:      true,
			discoverable:  false,
		},
		{
			name:          "private parent",
			publishAccess: PublishAccess{{ID: privateID, Visible: false, Password: privatePass}},
			blockTree:     newBlockTree(docID, "/"+privateID+"/"+docID+".sy"),
			metadata:      false,
			discoverable:  false,
		},
		{
			name:          "hidden notebook",
			publishAccess: PublishAccess{{ID: boxID, Visible: false}},
			blockTree:     newBlockTree(docID, "/"+docID+".sy"),
			metadata:      true,
			discoverable:  false,
		},
		{
			name:          "inconsistent visible forbidden",
			publishAccess: PublishAccess{{ID: inconsistentID, Visible: true, Disable: true}},
			blockTree:     newBlockTree(inconsistentID, "/"+inconsistentID+".sy"),
			metadata:      false,
			discoverable:  false,
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if actual := CheckBlockTreeMetadataAccessableByPublishAccess(c, test.publishAccess, test.blockTree); actual != test.metadata {
				t.Fatalf("metadata access = %v, want %v", actual, test.metadata)
			}
			if actual := CheckBlockTreeDiscoverableByPublishAccess(test.publishAccess, test.blockTree); actual != test.discoverable {
				t.Fatalf("discoverable = %v, want %v", actual, test.discoverable)
			}
		})
	}

	privateTree := newBlockTree(privateID, "/"+privateID+".sy")
	privateAccess := PublishAccess{{ID: privateID, Visible: false, Password: privatePass}}
	c.Request.AddCookie(&http.Cookie{
		Name:  "publish-auth-" + privateID,
		Value: util.SHA256Hash([]byte(privateID + privatePass)),
	})
	if !CheckBlockTreeMetadataAccessableByPublishAccess(c, privateAccess, privateTree) {
		t.Fatal("private document metadata should be accessible after authorization")
	}
	if CheckBlockTreeDiscoverableByPublishAccess(privateAccess, privateTree) {
		t.Fatal("private document should remain undiscoverable after authorization")
	}

	protectedChildTree := newBlockTree(childID, "/"+parentID+"/"+protectedID+"/"+childID+".sy")
	inheritedAccess := PublishAccess{
		{ID: parentID, Visible: false},
		{ID: protectedID, Visible: true, Password: protectedPass},
	}
	if CheckBlockTreeMetadataAccessableByPublishAccess(c, inheritedAccess, protectedChildTree) {
		t.Fatal("protected child metadata under a hidden parent should require authorization")
	}
	c.Request.AddCookie(&http.Cookie{
		Name:  "publish-auth-" + protectedID,
		Value: util.SHA256Hash([]byte(protectedID + protectedPass)),
	})
	if !CheckBlockTreeMetadataAccessableByPublishAccess(c, inheritedAccess, protectedChildTree) {
		t.Fatal("protected child metadata under a hidden parent should be accessible after authorization")
	}
	if CheckBlockTreeDiscoverableByPublishAccess(inheritedAccess, protectedChildTree) {
		t.Fatal("protected child under a hidden parent should remain undiscoverable")
	}
}

func TestCheckAttributeViewItemIDAccessableByPublishAccess(t *testing.T) {
	attrView := &av.AttributeView{
		KeyValues: []*av.KeyValues{
			{
				Key: &av.Key{Type: av.KeyTypeBlock},
				Values: []*av.Value{
					{BlockID: "detached-item", Type: av.KeyTypeBlock, IsDetached: true},
				},
			},
		},
	}
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodGet, "/", nil)

	if !checkAttributeViewItemIDAccessableByPublishAccess(c, PublishAccess{}, attrView, "detached-item") {
		t.Fatal("detached attribute view item should remain accessible")
	}
	if checkAttributeViewItemIDAccessableByPublishAccess(c, PublishAccess{}, attrView, "missing-item") {
		t.Fatal("attribute view item without a primary value should not expose assets")
	}

	detachedRow := &av.TableRow{Cells: []*av.TableCell{{
		BaseValue: &av.BaseValue{
			ValueType: av.KeyTypeBlock,
			Value:     &av.Value{Type: av.KeyTypeBlock, IsDetached: true},
		},
	}}}
	if !checkAttributeViewItemAccessableByPublishAccess(c, PublishAccess{}, detachedRow) {
		t.Fatal("detached attribute view row should remain accessible")
	}

	missingPrimaryRow := &av.TableRow{Cells: []*av.TableCell{{
		BaseValue: &av.BaseValue{
			ValueType: av.KeyTypeText,
			Value:     &av.Value{Type: av.KeyTypeText, Text: &av.ValueText{Content: "text"}},
		},
	}}}
	if checkAttributeViewItemAccessableByPublishAccess(c, PublishAccess{}, missingPrimaryRow) {
		t.Fatal("attribute view row without a primary value should not be accessible")
	}

	malformedPrimaryRow := &av.TableRow{Cells: []*av.TableCell{{
		BaseValue: &av.BaseValue{
			ValueType: av.KeyTypeBlock,
			Value:     &av.Value{Type: av.KeyTypeBlock},
		},
	}}}
	if checkAttributeViewItemAccessableByPublishAccess(c, PublishAccess{}, malformedPrimaryRow) {
		t.Fatal("non-detached attribute view row without a block should not be accessible")
	}
}

func TestCheckAttributeViewBlockTreesAccessableByPublishAccess(t *testing.T) {
	const (
		boxID             = "20260726000000-boxid01"
		publicID          = "20260726000001-public1"
		forbiddenID       = "20260726000002-forbid1"
		protectedID       = "20260726000003-protect"
		protectedPassword = "password"
	)
	newBlockTree := func(id string) *treenode.BlockTree {
		return &treenode.BlockTree{
			ID:    id,
			BoxID: boxID,
			Path:  "/" + id + ".sy",
		}
	}
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodGet, "/", nil)

	if checkAttributeViewBlockTreesAccessableByPublishAccess(c, PublishAccess{}, nil) {
		t.Fatal("attribute view without a mirror should not be accessible")
	}
	if !checkAttributeViewBlockTreesAccessableByPublishAccess(c, PublishAccess{}, map[string]*treenode.BlockTree{
		publicID: newBlockTree(publicID),
	}) {
		t.Fatal("attribute view with a public mirror should be accessible")
	}
	if checkAttributeViewBlockTreesAccessableByPublishAccess(c, PublishAccess{{ID: forbiddenID, Disable: true}}, map[string]*treenode.BlockTree{
		forbiddenID: newBlockTree(forbiddenID),
	}) {
		t.Fatal("attribute view with only a forbidden mirror should not be accessible")
	}
	if !checkAttributeViewBlockTreesAccessableByPublishAccess(c, PublishAccess{{ID: forbiddenID, Disable: true}}, map[string]*treenode.BlockTree{
		forbiddenID: newBlockTree(forbiddenID),
		publicID:    newBlockTree(publicID),
	}) {
		t.Fatal("attribute view should be accessible when any mirror is public")
	}

	protectedAccess := PublishAccess{{ID: protectedID, Visible: true, Password: protectedPassword}}
	protectedTrees := map[string]*treenode.BlockTree{protectedID: newBlockTree(protectedID)}
	if checkAttributeViewBlockTreesAccessableByPublishAccess(c, protectedAccess, protectedTrees) {
		t.Fatal("attribute view with only a protected mirror should require authorization")
	}
	c.Request.AddCookie(&http.Cookie{
		Name:  "publish-auth-" + protectedID,
		Value: util.SHA256Hash([]byte(protectedID + protectedPassword)),
	})
	if !checkAttributeViewBlockTreesAccessableByPublishAccess(c, protectedAccess, protectedTrees) {
		t.Fatal("attribute view with a protected mirror should be accessible after authorization")
	}
}

func TestFilterAttributeViewRelatedValuesByPublishAccess(t *testing.T) {
	const (
		sourceAvID       = "20260726000100-source1"
		targetAvID       = "20260726000101-target1"
		sourceItemID     = "20260726000102-sourcei"
		publicItemID     = "20260726000103-publici"
		privateItemID    = "20260726000104-private"
		blockKeyID       = "20260726000105-blockky"
		relationKeyID    = "20260726000106-relkey1"
		rollupKeyID      = "20260726000107-rollkey"
		targetBlockKeyID = "20260726000108-tblockk"
		targetTextKeyID  = "20260726000109-ttextk"
	)
	publicBlock := &av.Value{
		KeyID:      targetBlockKeyID,
		BlockID:    publicItemID,
		Type:       av.KeyTypeBlock,
		IsDetached: true,
		Block:      &av.ValueBlock{Content: "public"},
	}
	privateBlock := &av.Value{
		KeyID:      targetBlockKeyID,
		BlockID:    privateItemID,
		Type:       av.KeyTypeBlock,
		IsDetached: true,
		Block:      &av.ValueBlock{Content: "private"},
	}
	relationValue := &av.Value{
		KeyID:   relationKeyID,
		BlockID: sourceItemID,
		Type:    av.KeyTypeRelation,
		Relation: &av.ValueRelation{
			BlockIDs: []string{publicItemID, privateItemID},
			Contents: []*av.Value{publicBlock, privateBlock},
		},
	}
	rollupValue := &av.Value{
		KeyID:   rollupKeyID,
		BlockID: sourceItemID,
		Type:    av.KeyTypeRollup,
		Rollup: &av.ValueRollup{Contents: []*av.Value{
			{KeyID: targetTextKeyID, BlockID: publicItemID, Type: av.KeyTypeText, Text: &av.ValueText{Content: "public rollup"}},
			{KeyID: targetTextKeyID, BlockID: privateItemID, Type: av.KeyTypeText, Text: &av.ValueText{Content: "private rollup"}},
		}},
	}
	groupValue := relationValue.Clone()

	relationKey := &av.Key{
		ID:       relationKeyID,
		Type:     av.KeyTypeRelation,
		Relation: &av.Relation{AvID: targetAvID},
	}
	rollupKey := &av.Key{
		ID:   rollupKeyID,
		Type: av.KeyTypeRollup,
		Rollup: &av.Rollup{
			RelationKeyID: relationKeyID,
			KeyID:         targetTextKeyID,
		},
	}
	sourceAttrView := &av.AttributeView{
		ID: sourceAvID,
		KeyValues: []*av.KeyValues{
			{Key: &av.Key{ID: blockKeyID, Type: av.KeyTypeBlock}},
			{Key: relationKey, Values: []*av.Value{relationValue}},
			{Key: rollupKey, Values: []*av.Value{rollupValue}},
		},
	}
	targetAttrView := &av.AttributeView{
		ID: targetAvID,
		KeyValues: []*av.KeyValues{
			{Key: &av.Key{ID: targetBlockKeyID, Type: av.KeyTypeBlock}, Values: []*av.Value{publicBlock, privateBlock}},
			{Key: &av.Key{ID: targetTextKeyID, Type: av.KeyTypeText}, Values: []*av.Value{
				{KeyID: targetTextKeyID, BlockID: publicItemID, Type: av.KeyTypeText, Text: &av.ValueText{Content: "public rollup"}},
				{KeyID: targetTextKeyID, BlockID: privateItemID, Type: av.KeyTypeText, Text: &av.ValueText{Content: "private rollup"}},
			}},
		},
	}
	table := &av.Table{
		BaseInstance: &av.BaseInstance{GroupKey: relationKey, GroupValue: groupValue},
		Rows: []*av.TableRow{{
			ID: sourceItemID,
			Cells: []*av.TableCell{
				{BaseValue: &av.BaseValue{Value: relationValue, ValueType: av.KeyTypeRelation}},
				{BaseValue: &av.BaseValue{Value: rollupValue, ValueType: av.KeyTypeRollup}},
			},
		}},
	}
	filter := &attributeViewPublishAccessFilter{
		attributeViews: map[string]*av.AttributeView{
			sourceAvID: sourceAttrView,
			targetAvID: targetAttrView,
		},
		attributeAccess: map[string]bool{
			sourceAvID: true,
			targetAvID: true,
		},
		itemAccess: map[string]map[string]bool{
			targetAvID: {
				publicItemID:  true,
				privateItemID: false,
			},
		},
	}

	filter.filterViewable(sourceAttrView, table)

	filteredRelation := table.Rows[0].Cells[0].Value
	if filteredRelation == relationValue {
		t.Fatal("filtered relation should use a response-only clone")
	}
	if 1 != len(filteredRelation.Relation.BlockIDs) || publicItemID != filteredRelation.Relation.BlockIDs[0] {
		t.Fatalf("unexpected filtered relation IDs: %v", filteredRelation.Relation.BlockIDs)
	}
	if 1 != len(filteredRelation.Relation.Contents) || publicItemID != filteredRelation.Relation.Contents[0].BlockID {
		t.Fatalf("unexpected filtered relation contents: %v", filteredRelation.Relation.Contents)
	}
	if 2 != len(relationValue.Relation.BlockIDs) || 2 != len(relationValue.Relation.Contents) {
		t.Fatal("filtering the response should not mutate the source relation")
	}

	filteredRollup := table.Rows[0].Cells[1].Value
	if filteredRollup == rollupValue || 0 != len(filteredRollup.Rollup.Contents) {
		t.Fatal("rollup containing an inaccessible target should be cleared on a response-only clone")
	}
	if 2 != len(rollupValue.Rollup.Contents) {
		t.Fatal("filtering the response should not mutate the source rollup")
	}

	if table.GroupValue == groupValue || 1 != len(table.GroupValue.Relation.BlockIDs) ||
		publicItemID != table.GroupValue.Relation.BlockIDs[0] {
		t.Fatal("relation group value should be filtered on a response-only clone")
	}
	if 2 != len(groupValue.Relation.BlockIDs) {
		t.Fatal("filtering the group value should not mutate the source value")
	}
}

func TestFilterAttributeViewRelatedValuesKeepsPublicResponse(t *testing.T) {
	const (
		sourceAvID    = "20260726000200-source1"
		targetAvID    = "20260726000201-target1"
		sourceItemID  = "20260726000202-sourcei"
		targetItemID  = "20260726000203-targeti"
		relationKeyID = "20260726000204-relkey1"
		targetKeyID   = "20260726000205-blockky"
		rollupKeyID   = "20260726000206-rollkey"
		targetTextID  = "20260726000207-textkey"
	)
	targetBlock := &av.Value{
		KeyID:      targetKeyID,
		BlockID:    targetItemID,
		Type:       av.KeyTypeBlock,
		IsDetached: true,
		Block:      &av.ValueBlock{Content: "public"},
	}
	relationValue := &av.Value{
		KeyID:   relationKeyID,
		BlockID: sourceItemID,
		Type:    av.KeyTypeRelation,
		Relation: &av.ValueRelation{
			BlockIDs: []string{targetItemID},
			Contents: []*av.Value{targetBlock},
		},
	}
	rollupValue := &av.Value{
		KeyID:   rollupKeyID,
		BlockID: sourceItemID,
		Type:    av.KeyTypeRollup,
		Rollup: &av.ValueRollup{Contents: []*av.Value{{
			KeyID: targetTextID, BlockID: targetItemID, Type: av.KeyTypeText, Text: &av.ValueText{Content: "public rollup"},
		}}},
	}
	relationKey := &av.Key{ID: relationKeyID, Type: av.KeyTypeRelation, Relation: &av.Relation{AvID: targetAvID}}
	rollupKey := &av.Key{
		ID:   rollupKeyID,
		Type: av.KeyTypeRollup,
		Rollup: &av.Rollup{
			RelationKeyID: relationKeyID,
			KeyID:         targetTextID,
		},
	}
	sourceAttrView := &av.AttributeView{
		ID: sourceAvID,
		KeyValues: []*av.KeyValues{
			{Key: relationKey, Values: []*av.Value{relationValue}},
			{Key: rollupKey, Values: []*av.Value{rollupValue}},
		},
	}
	targetAttrView := &av.AttributeView{
		ID: targetAvID,
		KeyValues: []*av.KeyValues{
			{
				Key:    &av.Key{ID: targetKeyID, Type: av.KeyTypeBlock},
				Values: []*av.Value{targetBlock},
			},
			{
				Key: &av.Key{ID: targetTextID, Type: av.KeyTypeText},
				Values: []*av.Value{{
					KeyID: targetTextID, BlockID: targetItemID, Type: av.KeyTypeText, Text: &av.ValueText{Content: "public rollup"},
				}},
			},
		},
	}
	table := &av.Table{
		BaseInstance: &av.BaseInstance{},
		Rows: []*av.TableRow{{
			ID: sourceItemID,
			Cells: []*av.TableCell{
				{BaseValue: &av.BaseValue{Value: relationValue, ValueType: av.KeyTypeRelation}},
				{BaseValue: &av.BaseValue{Value: rollupValue, ValueType: av.KeyTypeRollup}},
			},
		}},
	}
	filter := &attributeViewPublishAccessFilter{
		attributeViews: map[string]*av.AttributeView{
			sourceAvID: sourceAttrView,
			targetAvID: targetAttrView,
		},
		attributeAccess: map[string]bool{sourceAvID: true, targetAvID: true},
		itemAccess: map[string]map[string]bool{
			targetAvID: {targetItemID: true},
		},
	}

	filter.filterViewable(sourceAttrView, table)
	if table.Rows[0].Cells[0].Value != relationValue {
		t.Fatal("fully accessible relation should remain unchanged")
	}
	if table.Rows[0].Cells[1].Value != rollupValue {
		t.Fatal("fully accessible rollup should remain unchanged")
	}

	filter.attributeAccess[targetAvID] = false
	filter.filterViewable(sourceAttrView, table)
	if table.Rows[0].Cells[0].Value == relationValue || 0 != len(table.Rows[0].Cells[0].Value.Relation.BlockIDs) {
		t.Fatal("relation to an inaccessible attribute view should be cleared on a response-only clone")
	}
	if 1 != len(relationValue.Relation.BlockIDs) {
		t.Fatal("clearing the response should not mutate the source relation")
	}
}

func TestFilterSearchDocsByPublishAccess(t *testing.T) {
	const (
		boxID             = "20260720000000-boxid01"
		hiddenBoxID       = "20260720000001-boxid02"
		hiddenDocID       = "20260720000002-hiddend"
		protectedDocID    = "20260720000003-protect"
		protectedPassword = "password"
	)
	publishAccess := PublishAccess{
		{ID: hiddenBoxID, Visible: false},
		{ID: hiddenDocID, Visible: false},
		{ID: protectedDocID, Visible: true, Password: protectedPassword},
	}
	docs := []map[string]string{
		{"box": boxID, "path": "/20260720000004-public1.sy"},
		{"box": hiddenBoxID, "path": "/"},
		{"box": boxID, "path": "/" + hiddenDocID + "/20260720000005-child01.sy"},
		{"box": boxID, "path": "/" + protectedDocID + ".sy"},
		{"box": boxID, "path": ""},
	}

	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodGet, "/", nil)
	filtered := FilterSearchDocsByPublishAccess(c, publishAccess, docs)
	if len(filtered) != 1 || filtered[0]["path"] != docs[0]["path"] {
		t.Fatalf("unexpected unauthenticated search docs: %v", filtered)
	}

	c.Request.AddCookie(&http.Cookie{
		Name:  "publish-auth-" + protectedDocID,
		Value: util.SHA256Hash([]byte(protectedDocID + protectedPassword)),
	})
	filtered = FilterSearchDocsByPublishAccess(c, publishAccess, docs)
	if len(filtered) != 2 || filtered[1]["path"] != docs[3]["path"] {
		t.Fatalf("unexpected authenticated search docs: %v", filtered)
	}
}

func TestFilterGraphByPublishAccess(t *testing.T) {
	const (
		boxID             = "20260724000000-boxid01"
		publicDocID       = "20260724000001-public1"
		protectedDocID    = "20260724000002-protect"
		protectedBlockID  = "20260724000003-block01"
		hiddenDocID       = "20260724000004-hidden1"
		protectedPassword = "password"
		sharedTagID       = "shared"
		protectedTagID    = "protected"
	)
	publishAccess := PublishAccess{
		{ID: protectedDocID, Visible: true, Password: protectedPassword},
		{ID: hiddenDocID, Visible: false},
	}
	newGraph := func() ([]*GraphNode, []*GraphLink) {
		return []*GraphNode{
				{ID: publicDocID, Box: boxID, Path: "/" + publicDocID + ".sy", Size: 10, Type: "NodeDocument"},
				{ID: protectedBlockID, Box: boxID, Path: "/" + protectedDocID + "/" + protectedBlockID + ".sy", Size: 10, Type: "NodeParagraph"},
				{ID: hiddenDocID, Box: boxID, Path: "/" + hiddenDocID + ".sy", Size: 10, Type: "NodeDocument"},
				{ID: sharedTagID, Label: sharedTagID, Size: 10, Type: "NodeTag"},
				{ID: protectedTagID, Label: protectedTagID, Size: 10, Type: "NodeTag"},
			}, []*GraphLink{
				{From: sharedTagID, To: publicDocID},
				{From: sharedTagID, To: protectedBlockID},
				{From: protectedTagID, To: protectedBlockID},
				{From: publicDocID, To: protectedBlockID, Ref: true},
				{From: publicDocID, To: hiddenDocID, Ref: true},
			}
	}

	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodGet, "/", nil)
	nodes, links := newGraph()
	filteredNodes, filteredLinks := FilterGraphByPublishAccess(c, publishAccess, nodes, links)
	if len(filteredNodes) != 2 || filteredNodes[0].ID != publicDocID || filteredNodes[1].ID != sharedTagID {
		t.Fatalf("unexpected unauthenticated graph nodes: %+v", filteredNodes)
	}
	if len(filteredLinks) != 1 || filteredLinks[0].From != sharedTagID || filteredLinks[0].To != publicDocID {
		t.Fatalf("unexpected unauthenticated graph links: %+v", filteredLinks)
	}
	if filteredNodes[0].Refs != 0 || filteredNodes[0].Defs != 0 || filteredNodes[1].Refs != 1 {
		t.Fatalf("unexpected unauthenticated graph counts: %+v", filteredNodes)
	}

	c.Request.AddCookie(&http.Cookie{
		Name:  "publish-auth-" + protectedDocID,
		Value: util.SHA256Hash([]byte(protectedDocID + protectedPassword)),
	})
	nodes, links = newGraph()
	filteredNodes, filteredLinks = FilterGraphByPublishAccess(c, publishAccess, nodes, links)
	if len(filteredNodes) != 4 || filteredNodes[1].ID != protectedBlockID || filteredNodes[3].ID != protectedTagID {
		t.Fatalf("unexpected authenticated graph nodes: %+v", filteredNodes)
	}
	if len(filteredLinks) != 4 {
		t.Fatalf("unexpected authenticated graph links: %+v", filteredLinks)
	}
	if filteredNodes[0].Refs != 1 || filteredNodes[1].Defs != 1 || filteredNodes[1].Size != 10 {
		t.Fatalf("unexpected authenticated graph counts: %+v", filteredNodes)
	}
}

func TestFilterEmbedBlocksByPublishAccessRemovesInternalFields(t *testing.T) {
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodGet, "/", nil)
	embedBlocks := []*EmbedBlock{{
		Block: &Block{
			Box:      "20260720000000-boxid01",
			Path:     "/20260720000004-public1.sy",
			HPath:    "/private/path",
			ID:       "20260720000005-block01",
			Content:  "<div>visible</div>",
			Markdown: "sensitive markdown",
			IAL:      map[string]string{"custom-secret": "sensitive ial"},
		},
		BlockPaths:          []*BlockPath{{ID: "20260720000004-public1", Name: "Public"}},
		AllowChildOperation: true,
	}}

	filtered := FilterEmbedBlocksByPublishAccess(c, PublishAccess{}, embedBlocks)
	if 1 != len(filtered) {
		t.Fatalf("unexpected filtered embed block count: %d", len(filtered))
	}
	block := filtered[0].Block
	if "20260720000005-block01" != block.ID || "<div>visible</div>" != block.Content {
		t.Fatalf("required embed block fields were not preserved: %+v", block)
	}
	if "" != block.Box || "" != block.Path || "" != block.HPath || "" != block.Markdown || nil != block.IAL {
		t.Fatalf("internal embed block fields were not removed: %+v", block)
	}
	if 1 != len(filtered[0].BlockPaths) || !filtered[0].AllowChildOperation {
		t.Fatalf("embed rendering metadata was not preserved: %+v", filtered[0])
	}
}

func TestFilterEmbedBlocksByPublishAccessDropsInaccessibleResults(t *testing.T) {
	const (
		boxID             = "20260720000000-boxid01"
		hiddenDocID       = "20260720000002-hiddend"
		protectedDocID    = "20260720000003-protect"
		protectedPassword = "password"
	)
	publishAccess := PublishAccess{
		{ID: hiddenDocID, Disable: true},
		{ID: protectedDocID, Visible: true, Password: protectedPassword},
	}
	embedBlocks := []*EmbedBlock{
		{Block: &Block{ID: "20260720000004-hidden1", Box: boxID, Path: "/" + hiddenDocID + ".sy", Content: "hidden"}},
		{Block: &Block{ID: "20260720000005-protect", Box: boxID, Path: "/" + protectedDocID + ".sy", Content: "protected"}},
	}

	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodGet, "/", nil)
	if filtered := FilterEmbedBlocksByPublishAccess(c, publishAccess, embedBlocks); 0 != len(filtered) {
		t.Fatalf("不可访问的嵌入块结果不应返回：%+v", filtered)
	}

	c.Request.AddCookie(&http.Cookie{
		Name:  "publish-auth-" + protectedDocID,
		Value: util.SHA256Hash([]byte(protectedDocID + protectedPassword)),
	})
	filtered := FilterEmbedBlocksByPublishAccess(c, publishAccess, embedBlocks)
	if 1 != len(filtered) || "20260720000005-protect" != filtered[0].Block.ID {
		t.Fatalf("密码验证后应仅返回已授权结果：%+v", filtered)
	}
}
