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
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAttributeViewRefCarrierTreesUseEveryMirrorOnce(t *testing.T) {
	const (
		boxID         = "20260904020000-box0001"
		attributeView = "20260904020001-av00001"
		firstRootID   = "20260904020002-root001"
		secondRootID  = "20260904020003-root002"
		firstBlockID  = "20260904020004-db00001"
		secondBlockID = "20260904020005-db00002"
		thirdBlockID  = "20260904020006-db00003"
	)
	setupExportRelatedTest(t, boxID)
	setupAttributeViewRefI18n(t)
	attrView := av.NewAttributeView(attributeView)
	if err := av.SaveAttributeView(attrView); nil != err {
		t.Fatal(err)
	}

	firstTree := newAttributeViewRefCarrierTestTree(boxID, firstRootID, attributeView, firstBlockID, secondBlockID)
	secondTree := newAttributeViewRefCarrierTestTree(boxID, secondRootID, attributeView, thirdBlockID)
	writeExportRelatedTestTree(t, firstTree)
	writeExportRelatedTestTree(t, secondTree)
	for _, blockID := range []string{firstBlockID, secondBlockID, thirdBlockID} {
		av.UpsertBlockRel(attributeView, blockID)
	}

	trees := attributeViewRefCarrierTrees(attributeView, "")
	if 2 != len(trees) {
		t.Fatalf("expected two unique carrier roots, got %d", len(trees))
	}
	roots := map[string]bool{}
	for _, tree := range trees {
		roots[tree.ID] = true
	}
	if !roots[firstRootID] || !roots[secondRootID] {
		t.Fatalf("unexpected carrier roots: %+v", roots)
	}
}

func TestAttributeViewRefCarrierTreesRequirePhysicalCarrier(t *testing.T) {
	const (
		boxID         = "20260904021000-box0001"
		attributeView = "20260904021001-av00001"
	)
	setupExportRelatedTest(t, boxID)
	setupAttributeViewRefI18n(t)
	if err := av.SaveAttributeView(av.NewAttributeView(attributeView)); nil != err {
		t.Fatal(err)
	}

	if trees := attributeViewRefCarrierTrees(attributeView, ""); 0 != len(trees) {
		t.Fatalf("attribute view without a carrier produced index trees: %+v", trees)
	}
}

func TestSameAttributeViewRefBoundary(t *testing.T) {
	const (
		encryptedBox      = "20260904022000-encbox1"
		otherEncryptedBox = "20260904022001-encbox2"
		normalBox         = "20260904022002-box0001"
	)
	markRuntimeEncryptedBox(encryptedBox)
	markRuntimeEncryptedBox(otherEncryptedBox)
	t.Cleanup(func() {
		forgetRuntimeEncryptedBox(encryptedBox)
		forgetRuntimeEncryptedBox(otherEncryptedBox)
	})

	if !sameAttributeViewRefBoundary("", normalBox) {
		t.Fatal("global attribute views should allow normal notebook carriers")
	}
	if sameAttributeViewRefBoundary("", encryptedBox) {
		t.Fatal("global attribute views should reject encrypted notebook carriers")
	}
	if !sameAttributeViewRefBoundary(encryptedBox, encryptedBox) {
		t.Fatal("encrypted attribute views should allow carriers in the same notebook")
	}
	if sameAttributeViewRefBoundary(encryptedBox, otherEncryptedBox) {
		t.Fatal("encrypted attribute views should reject carriers in another encrypted notebook")
	}
	if sameAttributeViewRefBoundary(encryptedBox, normalBox) {
		t.Fatal("encrypted attribute views should reject normal notebook carriers")
	}
}

func TestParseAttributeViewRefRepoPath(t *testing.T) {
	const (
		avID  = "20260904023000-av00001"
		boxID = "20260904023001-encbox1"
	)
	tests := []struct {
		name      string
		path      string
		wantAVID  string
		wantBoxID string
		wantOK    bool
	}{
		{name: "global", path: "/storage/av/" + avID + ".json", wantAVID: avID, wantOK: true},
		{name: "relative global", path: "storage/av/" + avID + ".json", wantAVID: avID, wantOK: true},
		{name: "encrypted", path: "/" + boxID + "/storage/av/" + avID + ".json", wantAVID: avID, wantBoxID: boxID, wantOK: true},
		{name: "windows separators", path: boxID + "\\storage\\av\\" + avID + ".json", wantAVID: avID, wantBoxID: boxID, wantOK: true},
		{name: "nested", path: "/backup/storage/av/" + avID + ".json"},
		{name: "invalid id", path: "/storage/av/not-an-id.json"},
		{name: "wrong extension", path: "/storage/av/" + avID + ".json.bak"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			gotAVID, gotBoxID, gotOK := parseAttributeViewRefRepoPath(test.path)
			if gotAVID != test.wantAVID || gotBoxID != test.wantBoxID || gotOK != test.wantOK {
				t.Fatalf("parse result = (%q, %q, %t), want (%q, %q, %t)", gotAVID, gotBoxID, gotOK,
					test.wantAVID, test.wantBoxID, test.wantOK)
			}
		})
	}
}

func setupAttributeViewRefI18n(t *testing.T) {
	t.Helper()
	originalLang, originalLangs := util.Lang, util.AttrViewLangs
	util.Lang = "en"
	util.AttrViewLangs = map[string]map[string]any{
		"en": {"key": "Key", "select": "Select", "table": "Table"},
	}
	t.Cleanup(func() {
		util.Lang, util.AttrViewLangs = originalLang, originalLangs
	})
}

func newAttributeViewRefCarrierTestTree(boxID, rootID, avID string, blockIDs ...string) *parse.Tree {
	tree := treenode.NewTree(boxID, "/"+rootID+".sy", "/Database", "Database")
	for nil != tree.Root.FirstChild {
		tree.Root.FirstChild.Unlink()
	}
	for _, blockID := range blockIDs {
		databaseNode := &ast.Node{
			Type: ast.NodeAttributeView, ID: blockID, AttributeViewID: avID,
			AttributeViewType: string(av.LayoutTypeTable),
		}
		databaseNode.SetIALAttr("id", blockID)
		tree.Root.AppendChild(databaseNode)
	}
	return tree
}
