// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5

package model

import (
	"testing"

	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAttributeViewIconCreationDefaultsDoNotChangeExistingViews(t *testing.T) {
	fixture, _, _, _ := setupAttributeViewItemsTest(t, false)
	setAttributeViewListTestLangs()
	util.AttrViewLangs["en"]["calendar"] = "Calendar"
	editor := conf.NewEditor()
	editor.DatabaseShowIcon, editor.DatabaseShowRelationIcon = new(false), new(true)
	Conf.Editor.Store(editor)
	created, err := CreateAttributeViewDatabase(fixture.sourceID, "", "", "Icons", "Task", av.LayoutTypeTable, nil)
	if err != nil {
		t.Fatal(err)
	}
	check := func(id string, primary, relation bool) {
		t.Helper()
		_, view, err := GetAttributeViewViewTarget(created.AvID, created.BlockID, id)
		if err != nil {
			t.Fatal(err)
		}
		base := view.GetBaseLayout()
		if base.ShowIcon != primary || base.EffectiveShowRelationIcon() != relation {
			t.Fatalf("unexpected icons for %s: %+v", id, base)
		}
	}
	check(created.ViewID, false, true)
	editor = conf.NewEditor()
	editor.DatabaseShowIcon, editor.DatabaseShowRelationIcon = new(true), new(false)
	Conf.Editor.Store(editor)
	for _, kind := range []av.LayoutType{av.LayoutTypeTable, av.LayoutTypeList, av.LayoutTypeCalendar, av.LayoutTypeGallery, av.LayoutTypeKanban} {
		id, err := AddAttributeViewView(created.AvID, created.BlockID, "New view", kind)
		if err != nil {
			t.Fatal(err)
		}
		check(id, true, false)
		check(created.ViewID, false, true)
	}
	copyID, err := DuplicateAttributeViewView(created.AvID, created.BlockID, created.ViewID, "Copy")
	if err != nil {
		t.Fatal(err)
	}
	check(copyID, false, true)
}
