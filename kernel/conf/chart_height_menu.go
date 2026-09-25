package conf

// 将图表高度配置合并到公共高度入口，保留已有公共配置及插件顺序。
func migrateChartHeightMenu(profile *EntryVisibilityProfile) {
	const legacy = "gutter.single.chart.height"
	const target = "gutter.single.height"
	if visible, ok := profile.Entries[legacy]; ok {
		if _, exists := profile.Entries[target]; !exists {
			parent, configured := profile.Entries["gutter.single.chart"]
			profile.Entries[target] = visible && (!configured || parent)
		}
		delete(profile.Entries, legacy)
	}
	if order, ok := profile.Orders["gutter.single.chart"]; ok {
		filtered := make([]string, 0, len(order))
		for _, key := range order {
			if key != "height" {
				filtered = append(filtered, key)
			}
		}
		profile.Orders["gutter.single.chart"] = filtered
	}
}
