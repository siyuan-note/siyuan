// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"fmt"
	"slices"
	"testing"
	"time"

	"github.com/siyuan-note/siyuan/kernel/av"
)

func TestSubItemsGroupOrderStorageScalesWithMembers(t *testing.T) {
	for _, count := range []int{1000, 10000} {
		t.Run(fmt.Sprint(count), func(t *testing.T) {
			index := &av.SubItemsIndex{Parents: map[string]string{}, Children: map[string][]string{}}
			view := &av.View{}
			for i := 0; i < count; i++ {
				root, first, second := fmt.Sprintf("root-%d", i), fmt.Sprintf("first-%d", i), fmt.Sprintf("second-%d", i)
				index.Roots = append(index.Roots, root)
				index.Parents[root], index.Parents[first], index.Parents[second] = "", root, root
				index.Children[root] = []string{first, second}
				view.ItemIDs = append(view.ItemIDs, root, first, second)
				// 子项自己的字段值不属于父项分组，平铺组只含根。
				view.Groups = append(view.Groups, &av.View{ID: fmt.Sprintf("group-%d", i), GroupItemIDs: []string{root}})
			}
			started := time.Now()
			moveSubItemOrder(view, index, []string{"second-0"}, "", "first-0")
			stored := 0
			for _, group := range view.Groups {
				stored += len(group.SubItemsItemIDs)
			}
			if stored != 3 || !slices.Equal(view.Groups[0].SubItemsItemIDs, []string{"root-0", "second-0", "first-0"}) {
				t.Fatalf("single tree move stored %d items across %d groups", stored, count)
			}
			selected := make([]string, count)
			for i := range selected {
				selected[i] = fmt.Sprintf("first-%d", i)
			}
			moveSubItemOrder(view, index, selected, "", "")
			stored = 0
			for _, group := range view.Groups {
				stored += len(group.SubItemsItemIDs)
				if len(group.SubItemsItemIDs) != 3 || len(group.GroupItemIDs) != 1 {
					t.Fatal("group order contains another tree or changed flat membership")
				}
			}
			if stored != count*3 {
				t.Fatalf("tree order storage is not linear: %d", stored)
			}
			t.Logf("%d groups / %d rows, single and all-tree moves: %s", count, len(index.Parents), time.Since(started))
		})
	}
}

func TestSubItemsGroupOrderIsolationAndMissingViewMembers(t *testing.T) {
	index := &av.SubItemsIndex{Parents: map[string]string{"p": "", "a": "p", "b": "p", "q": ""}, Children: map[string][]string{"p": {"a", "b"}}, Roots: []string{"p", "q"}}
	view := &av.View{ItemIDs: []string{"p", "a", "q"}, Groups: []*av.View{
		{ID: "A", GroupItemIDs: []string{"p"}}, {ID: "B", GroupItemIDs: []string{"p"}}, {ID: "C", GroupItemIDs: []string{"q"}},
	}}
	moveSubItemOrder(view, index, []string{"a"}, "b", "", "A")
	if !slices.Equal(view.Groups[0].SubItemsItemIDs, []string{"p", "b", "a"}) {
		t.Fatal("missing source member was not included in complete sibling order")
	}
	if len(view.Groups[1].SubItemsItemIDs) != 0 || !slices.Equal(view.ItemIDs, []string{"p", "a", "q"}) {
		t.Fatal("explicit group move changed another group's fallback order")
	}
	index.Parents["b"], index.Children["p"], index.Children["q"] = "q", []string{"a"}, []string{"b"}
	moveSubItemOrder(view, index, []string{"b"}, "", "", "A")
	if slices.Contains(view.Groups[0].SubItemsItemIDs, "b") {
		t.Fatal("moving a subtree retained its order in the old group")
	}
}
