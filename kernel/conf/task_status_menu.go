package conf

import "strings"

// 展开任务状态子菜单，合并重复入口的可见性，并在原菜单位置保留子项顺序及插件位置。
func migrateTaskStatusMenu(profile *EntryVisibilityProfile) {
	const parent = "gutter.single.listBlock"
	const legacy = parent + ".taskStatus"
	defaults := []string{"taskStatusTodo", "taskStatusInProgress", "taskStatusDone", "taskStatusCanceled", "customTaskStatus"}
	entries, orders := profile.Entries, profile.Orders
	var nestedPaths []string
	for path := range entries {
		if strings.HasPrefix(path, legacy+".") {
			nestedPaths = append(nestedPaths, path)
		}
	}
	saved := orders[parent]
	_, hasEntry := entries[legacy]
	_, hasOrder := orders[legacy]
	hasAnchor := false
	for _, key := range saved {
		if key == "taskStatus" {
			hasAnchor = true
		}
	}
	if !hasEntry && !hasOrder && len(nestedPaths) == 0 && !hasAnchor {
		return
	}
	isVisible := func(path string) bool {
		visible, configured := entries[path]
		return !configured || visible
	}
	parentVisible := isVisible(legacy)
	customVisible := isVisible(parent+".customTaskStatus") || parentVisible && isVisible(legacy+".customTaskStatus")
	for _, key := range defaults {
		visible := parentVisible && isVisible(legacy+"."+key)
		if key == "customTaskStatus" {
			visible = customVisible
		}
		entries[parent+"."+key] = visible
	}
	for _, path := range nestedPaths {
		target := parent + strings.TrimPrefix(path, legacy)
		if _, exists := entries[target]; !exists {
			entries[target] = parentVisible && entries[path]
		}
		delete(entries, path)
	}
	delete(entries, legacy)
	var children []string
	seenChildren := map[string]bool{}
	for _, key := range append(append([]string{}, orders[legacy]...), defaults...) {
		if !seenChildren[key] && key != "taskStatus" && key != "separator_taskStatus" {
			children = append(children, key)
			seenChildren[key] = true
		}
	}
	anchor := "customTaskStatus"
	if hasAnchor {
		anchor = "taskStatus"
	}
	var expanded []string
	seen := map[string]bool{}
	appendUnique := func(keys ...string) {
		for _, key := range keys {
			if !seen[key] {
				expanded = append(expanded, key)
				seen[key] = true
			}
		}
	}
	appendChildren := func() {
		appendUnique(children...)
		appendUnique("separator_taskStatus")
	}
	found := false
	for _, key := range saved {
		if key == anchor {
			found = true
		}
	}
	if !found {
		appendChildren()
	}
	for _, key := range saved {
		if key == anchor {
			appendChildren()
		} else if key != "taskStatus" && key != "customTaskStatus" && key != "separator_taskStatus" {
			appendUnique(key)
		}
	}
	orders[parent] = expanded
	delete(orders, legacy)
}
