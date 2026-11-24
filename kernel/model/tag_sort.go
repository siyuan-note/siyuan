// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"

	"github.com/88250/gulu"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/util"
)

const tagSortPath = ".siyuan/tag-sort.json"

type tagSortGroups map[string][]string

type tagSortFile struct {
	Version int           `json:"version"`
	Groups  tagSortGroups `json:"groups"`
}

func tagSortGroup(label string) string {
	return label[:strings.LastIndexByte(label, '/')+1]
}

func readTagSort() (tagSortGroups, error) {
	path := filepath.Join(util.DataDir, tagSortPath)
	unlock := filelock.LockPaths(path)
	defer unlock()
	return readTagSortFile(path)
}

func readTagSortFile(path string) (tagSortGroups, error) {
	data, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return tagSortGroups{}, nil
	}
	if err != nil {
		return nil, err
	}
	var file tagSortFile
	if err = json.Unmarshal(data, &file); err != nil {
		return nil, err
	}
	if file.Version != 1 || file.Groups == nil {
		return nil, fmt.Errorf("invalid tag order format [%d]", file.Version)
	}
	for group, labels := range file.Groups {
		seen := make(map[string]bool, len(labels))
		for _, label := range labels {
			if tagSortGroup(label) != group || seen[label] {
				return nil, fmt.Errorf("invalid sibling tag order")
			}
			seen[label] = true
		}
	}
	return file.Groups, nil
}

func updateTagSort(update func(tagSortGroups) (bool, error)) error {
	path := filepath.Join(util.DataDir, tagSortPath)
	unlock := filelock.LockPaths(path)
	defer unlock()
	groups, err := readTagSortFile(path)
	if err != nil {
		return err
	}
	changed, err := update(groups)
	if err != nil || !changed {
		return err
	}
	data, err := json.Marshal(tagSortFile{Version: 1, Groups: groups})
	if err != nil {
		return err
	}
	if err = os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return err
	}
	if err = gulu.File.WriteFileSafer(path, data, 0644); err != nil {
		return err
	}
	IncSyncIfNeeded(path)
	ReloadTag()
	return nil
}

func ReorderTag(label, target, position string) error {
	group := tagSortGroup(label)
	if label == "" || target == "" || label == target || group != tagSortGroup(target) || (position != "before" && position != "after") {
		return fmt.Errorf("invalid sibling tag move")
	}
	FlushTxQueue()
	sql.FlushQueue()
	return updateTagSort(func(groups tagSortGroups) (bool, error) {
		labels, err := labelTagCounts()
		if err != nil {
			return false, err
		}
		siblings := tagSiblings(labels, group)
		if !slices.Contains(siblings, label) || !slices.Contains(siblings, target) {
			return false, fmt.Errorf("sibling tag is unavailable")
		}
		next := moveTagWithinGroup(groups[group], siblings, label, target, position == "after")
		if next == nil {
			return false, nil
		}
		groups[group] = next
		return true, nil
	})
}

func tagSiblings(labels map[string]int, group string) []string {
	found := map[string]bool{}
	for label := range labels {
		name, ok := strings.CutPrefix(label, group)
		if ok {
			name, _, _ = strings.Cut(name, "/")
			found[group+name] = true
		}
	}
	siblings := make([]string, 0, len(found))
	for label := range found {
		siblings = append(siblings, label)
	}
	slices.SortFunc(siblings, func(left, right string) int {
		left, right = util.EscapeHTML(left[len(group):]), util.EscapeHTML(right[len(group):])
		if naturalTagLess(left, right) {
			return -1
		}
		if left == right {
			return 0
		}
		return 1
	})
	return siblings
}

func moveTagWithinGroup(saved, siblings []string, label, target string, after bool) []string {
	present := make(map[string]bool, len(siblings))
	for _, sibling := range siblings {
		present[sibling] = true
	}
	// 未打开笔记本中的标签可能暂时不在索引中，移动时保留它们的排序位置。
	complete := slices.Clone(saved)
	seen := make(map[string]bool, len(saved))
	var visibleSlots []int
	var visible []string
	for index, sibling := range saved {
		seen[sibling] = true
		if present[sibling] {
			visibleSlots = append(visibleSlots, index)
			visible = append(visible, sibling)
		}
	}
	for _, sibling := range siblings {
		if !seen[sibling] {
			visibleSlots = append(visibleSlots, len(complete))
			complete = append(complete, sibling)
			visible = append(visible, sibling)
		}
	}

	source := slices.Index(visible, label)
	destination := slices.Index(visible, target)
	if after {
		destination++
	}
	if source < destination {
		destination--
	}
	if source == destination {
		return nil
	}
	visible = slices.Delete(visible, source, source+1)
	visible = slices.Insert(visible, destination, label)
	for i, slot := range visibleSlots {
		complete[slot] = visible[i]
	}
	return complete
}

func renameTagSort(oldLabel, newLabel string) error {
	return updateTagSort(func(groups tagSortGroups) (bool, error) {
		return renameTagSortGroups(groups, oldLabel, newLabel), nil
	})
}

func removeTagSort(labels []string) error {
	return updateTagSort(func(groups tagSortGroups) (bool, error) {
		changed := false
		for _, label := range labels {
			group := tagSortGroup(label)
			siblings := groups[group]
			index := slices.Index(siblings, label)
			if index < 0 {
				continue
			}
			if len(siblings) == 1 {
				delete(groups, group)
			} else {
				groups[group] = slices.Delete(siblings, index, index+1)
			}
			changed = true
		}
		return changed, nil
	})
}

func renameTagSortGroups(groups tagSortGroups, oldLabel, newLabel string) bool {
	oldParent, newParent := tagSortGroup(oldLabel), tagSortGroup(newLabel)
	changed := false
	siblings := groups[oldParent]
	if index := slices.Index(siblings, oldLabel); index >= 0 {
		if oldParent == newParent && !slices.Contains(siblings, newLabel) {
			siblings[index] = newLabel
		} else {
			siblings = slices.Delete(siblings, index, index+1)
		}
		if len(siblings) == 0 {
			delete(groups, oldParent)
		} else {
			groups[oldParent] = siblings
		}
		changed = true
	}

	oldPrefix, newPrefix := oldLabel+"/", newLabel+"/"
	moved := tagSortGroups{}
	for group, labels := range groups {
		suffix, ok := strings.CutPrefix(group, oldPrefix)
		if !ok {
			continue
		}
		for i, label := range labels {
			labels[i] = newPrefix + strings.TrimPrefix(label, oldPrefix)
		}
		moved[newPrefix+suffix] = labels
		delete(groups, group)
		changed = true
	}
	for group, labels := range moved {
		order := groups[group]
		seen := make(map[string]bool, len(order)+len(labels))
		for _, label := range order {
			seen[label] = true
		}
		for _, label := range labels {
			if !seen[label] {
				order = append(order, label)
				seen[label] = true
			}
		}
		groups[group] = order
	}
	return changed
}
