// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"os"
	"path/filepath"
	"reflect"
	"slices"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestManualTagOrderBuildsAndMovesOnlySiblings(t *testing.T) {
	labels := map[string]int{
		"archive": 5, "project/2": 1, "project/10": 2, "project/1/nested": 2,
	}
	saved := []string{"project/10", "project/offline", "project/1"}
	siblings := tagSiblings(labels, "project/")
	if !slices.Equal(siblings, []string{"project/1", "project/2", "project/10"}) {
		t.Fatal(siblings)
	}
	moved := moveTagWithinGroup(saved, siblings, "project/2", "project/1", false)
	if !slices.Equal(moved, []string{"project/10", "project/offline", "project/2", "project/1"}) {
		t.Fatal(moved)
	}
	if !slices.Equal(saved, []string{"project/10", "project/offline", "project/1"}) {
		t.Fatal("move mutated its input")
	}
	if noChange := moveTagWithinGroup(moved, siblings, "project/2", "project/10", true); noChange != nil {
		t.Fatal(noChange)
	}
	groups := tagSortGroups{"": {"project", "archive"}, "project/": moved}
	labels["project/0"] = 1
	tags := buildTagTree(labels, util.SortModeCustom, groups, nil)
	if tags[0].Name != "project" || tags[0].Count != 0 || tags[1].Name != "archive" {
		t.Fatal("manual root order or derived parent count changed")
	}
	want := []string{"10", "2", "1", "0"}
	for i, child := range tags[0].Children {
		if child.Name != want[i] {
			t.Fatalf("child %d = %s, want %s", i, child.Name, want[i])
		}
	}
	automatic := buildTagTree(labels, util.SortModeAlphanumASC, groups, nil)
	if automatic[0].Name != "archive" || automatic[1].Children[0].Name != "0" {
		t.Fatal("manual positions were applied to automatic sorting")
	}
	labels["project/1/heavy"] = 4
	counts := buildTagTree(labels, util.SortModeRefCountDESC, nil, nil)
	if counts[1].Children[3].Children[0].Name != "heavy" {
		t.Fatal("grandchildren were sorted before their counts were available")
	}
}

func TestManualTagOrderRemapsRenamedGroups(t *testing.T) {
	groups := tagSortGroups{
		"":             {"archive", "project", "work"},
		"project/":     {"project/2", "project/1"},
		"project/1/":   {"project/1/deep"},
		"project/2/":   {"project/2/deep"},
		"work/":        {"work/1", "work/3"},
		"work/1/":      {"work/1/first"},
		"project-old/": {"project-old/1"},
	}
	if !renameTagSortGroups(groups, "project", "work") {
		t.Fatal("matching order was not renamed")
	}
	want := tagSortGroups{
		"":             {"archive", "work"},
		"work/":        {"work/1", "work/3", "work/2"},
		"work/1/":      {"work/1/first", "work/1/deep"},
		"work/2/":      {"work/2/deep"},
		"project-old/": {"project-old/1"},
	}
	if !reflect.DeepEqual(groups, want) {
		t.Fatalf("groups=%v, want %v", groups, want)
	}
	if !renameTagSortGroups(groups, "work/2", "work/4") || !slices.Equal(groups["work/"], []string{"work/1", "work/3", "work/4"}) {
		t.Fatalf("same-parent rename changed the slot: %v", groups)
	}
	if !renameTagSortGroups(groups, "work/4", "archive/4") ||
		!slices.Equal(groups["archive/4/"], []string{"archive/4/deep"}) || len(groups["archive/"]) != 0 {
		t.Fatalf("cross-parent rename did not preserve the child group: %v", groups)
	}
}

func TestManualTagOrderRejectsDamagedOrFutureFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "tag-sort.json")
	if groups, err := readTagSortFile(path); err != nil || len(groups) != 0 {
		t.Fatalf("missing file: groups=%v, error=%v", groups, err)
	}
	for _, data := range []string{
		"{",
		"{\"version\":2,\"groups\":{}}",
		"{\"version\":1,\"groups\":{\"parent/\":[\"different/tag\"]}}",
		"{\"version\":1,\"groups\":{\"parent/\":[\"parent/tag\",\"parent/tag\"]}}",
	} {
		if err := os.WriteFile(path, []byte(data), 0644); err != nil {
			t.Fatal(err)
		}
		if _, err := readTagSortFile(path); err == nil {
			t.Fatalf("accepted %s", data)
		}
	}
}
