// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"reflect"
	"strconv"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/filesys"
)

func TestRegenerateAttributeViewGroupsSkipsUnrelatedTemplates(t *testing.T) {
	tree, database, view := setupAttributeViewTemplateStatTest(t)
	block := database.GetBlockKeyValues().Values[0]
	block.IsDetached, block.Block.ID = false, tree.ID
	field := database.KeyValues[1]
	view.Group = &av.ViewGroup{Field: field.Key.ID, Method: av.GroupMethodValue, Order: av.GroupOrderMan}
	storedTemplates := map[*av.Value]string{}
	for _, values := range database.KeyValues[2:] {
		for _, value := range values.Values {
			storedTemplates[value] = value.Template.Content
		}
	}
	regenAttrViewGroups(database)
	group := view.GetGroupByGroupValue(field.Values[0].Text.Content)
	if group == nil || !reflect.DeepEqual(group.GroupItemIDs, []string{block.BlockID}) {
		t.Fatalf("bound row was not grouped by its stored value: %+v", group)
	}
	group.GroupFolded, group.GroupHidden = true, 2
	group.SubItemsItemIDs = []string{block.BlockID}
	id, layoutID := group.ID, group.Table.ID
	field.Values[1].Text.Content = field.Values[0].Text.Content
	regenAttrViewGroups(database)
	group = view.GetGroupByGroupValue(field.Values[0].Text.Content)
	if group == nil || group.ID != id || group.Table.ID != layoutID || !group.GroupFolded || group.GroupHidden != 2 ||
		!reflect.DeepEqual(group.GroupItemIDs, view.ItemIDs) || !reflect.DeepEqual(group.SubItemsItemIDs, []string{block.BlockID}) {
		t.Fatalf("group regeneration changed membership, identity or saved state: %+v", group)
	}
	for value, content := range storedTemplates {
		if value.Template.Content != content {
			t.Fatal("stored grouping evaluated an unrelated template")
		}
	}
	if len(database.RenderedViewables) != 0 {
		t.Fatal("partial group source entered the full-view cache")
	}

	view.Group.Field = "source"
	regenAttrViewGroups(database)
	stat := filesys.StatBlock(tree.ID)
	group = view.GetGroupByGroupValue(strconv.Itoa(stat.WordCount))
	if group == nil || len(group.GroupItemIDs) != 2 {
		t.Fatal("template grouping did not use current document statistics")
	}
}
