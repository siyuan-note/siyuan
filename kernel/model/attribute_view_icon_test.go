// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAttributeViewIconDefaultsAndLayoutCopies(t *testing.T) {
	setupAttributeViewValidationTest(t)
	setAttributeViewListTestLangs()
	util.AttrViewLangs["en"]["calendar"] = "Calendar"
	utilLayouts := []av.LayoutType{av.LayoutTypeTable, av.LayoutTypeList, av.LayoutTypeCalendar, av.LayoutTypeGallery, av.LayoutTypeKanban}
	for _, primary := range []bool{false, true} {
		for _, relation := range []bool{false, true} {
			editor := conf.NewEditor()
			editor.DatabaseShowIcon, editor.DatabaseShowRelationIcon = new(primary), new(relation)
			Conf.Editor.Store(editor)
			for _, kind := range utilLayouts {
				database := newAttributeViewWithLayout(ast.NewNodeID(), kind)
				view := database.Views[0]
				assertIcons := func(v *av.View) {
					t.Helper()
					base := v.GetBaseLayout()
					if base.ShowIcon != primary || base.ShowRelationIcon == nil || *base.ShowRelationIcon != relation {
						t.Fatalf("incorrect %s icons: %+v", v.LayoutType, base)
					}
				}
				assertIcons(view)
				for _, next := range utilLayouts {
					if err := changeAttrViewLayout(database, view, next); err != nil {
						t.Fatal(err)
					}
					assertIcons(view)
				}
				copy := &av.View{LayoutType: view.LayoutType}
				if err := cloneAttributeViewLayouts(copy, view); err != nil {
					t.Fatal(err)
				}
				assertIcons(copy)
				*copy.GetBaseLayout().ShowRelationIcon = !relation
				assertIcons(view)
			}
		}
	}
}

func TestAttributeViewIconSettersPreserveLegacyAndUndo(t *testing.T) {
	setupAttributeViewValidationTest(t)
	for _, legacy := range []bool{false, true} {
		database := av.NewAttributeView(ast.NewNodeID())
		database.Views[0].Table.ShowIcon = legacy
		if err := av.SaveAttributeView(database); err != nil {
			t.Fatal(err)
		}
		check := func(primary, relation bool) {
			t.Helper()
			cache.ClearAVCache()
			loaded, err := av.ParseAttributeView(database.ID)
			if err != nil {
				t.Fatal(err)
			}
			base := loaded.Views[0].GetBaseLayout()
			if base.ShowIcon != primary || base.EffectiveShowRelationIcon() != relation {
				t.Fatalf("unexpected persisted icons: %+v", base)
			}
		}
		check(legacy, legacy)
		if err := setAttrViewShowIcon(&Operation{AvID: database.ID, Data: !legacy}); err != nil {
			t.Fatal(err)
		}
		check(!legacy, legacy)
		if err := setAttrViewShowRelationIcon(&Operation{AvID: database.ID, Data: !legacy}); err != nil {
			t.Fatal(err)
		}
		check(!legacy, !legacy)
		if err := setAttrViewShowRelationIcon(&Operation{AvID: database.ID, Data: legacy}); err != nil {
			t.Fatal(err)
		}
		check(!legacy, legacy)
		if err := setAttrViewShowIcon(&Operation{AvID: database.ID, Data: legacy}); err != nil {
			t.Fatal(err)
		}
		check(legacy, legacy)
	}
}
