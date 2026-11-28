// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package conf

import "slices"

// 将旧卡源子菜单中的全局工具合并到主菜单，已有主菜单配置优先。
func migrateFlashcardMenu(profile *EntryVisibilityProfile) {
	const target = "mainMenu.riffCard"
	moved := map[string]string{
		"management": "manage", "reviewSets": "reviewSets", "presets": "presets",
		"statistics": "statistics", "anki": "anki",
	}
	visibility := map[string]bool{}
	var order []string
	for _, parent := range []string{"docTree.document.riffCard", "document.title.riffCard", "gutter.single",
		"docTree.multi.riffCard", "gutter.multi"} {
		source := parent + ".addToDeck"
		parentVisible, hasParent := profile.Entries[parent]
		sourceVisible, hasSource := profile.Entries[source]
		for key, newKey := range moved {
			path := source + "." + key
			if visible, ok := profile.Entries[path]; ok {
				visibility[newKey] = visibility[newKey] || visible && (!hasParent || parentVisible) && (!hasSource || sourceVisible)
				delete(profile.Entries, path)
			}
		}
		if saved, ok := profile.Orders[source]; ok {
			remaining := make([]string, 0, len(saved))
			for _, key := range saved {
				if newKey, ok := moved[key]; ok {
					if !slices.Contains(order, newKey) {
						order = append(order, newKey)
					}
				} else {
					remaining = append(remaining, key)
				}
			}
			if len(remaining) != len(saved) {
				profile.Orders[source] = remaining
			}
		}
	}
	for key, visible := range visibility {
		path := target + "." + key
		if _, ok := profile.Entries[path]; !ok {
			profile.Entries[path] = visible
		}
	}
	if _, ok := profile.Orders[target]; !ok && len(order) > 0 {
		profile.Orders[target] = order
	}
}
