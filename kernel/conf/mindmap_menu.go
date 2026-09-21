package conf

// 将脑图入口迁移到转换菜单，保留显式可见性和其余菜单项顺序。
func migrateMindmapMenu(profile *EntryVisibilityProfile) {
	const oldParent = "gutter.single.listBlock"
	const oldPath = oldParent + ".listMindmap"
	const newPath = "gutter.single.turnInto.listMindmap"
	if visible, exists := profile.Entries[oldPath]; exists {
		if _, configured := profile.Entries[newPath]; !configured {
			parentVisible, parentConfigured := profile.Entries[oldParent]
			profile.Entries[newPath] = visible && (!parentConfigured || parentVisible)
		}
		delete(profile.Entries, oldPath)
	} else if visible, exists := profile.Entries[oldParent]; exists && !visible {
		if _, configured := profile.Entries[newPath]; !configured {
			profile.Entries[newPath] = false
		}
	}
	if order, exists := profile.Orders[oldParent]; exists {
		filtered := make([]string, 0, len(order))
		for _, key := range order {
			if key != "listMindmap" {
				filtered = append(filtered, key)
			}
		}
		profile.Orders[oldParent] = filtered
	}
}
