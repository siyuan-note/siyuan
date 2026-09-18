package model

import (
	"sort"
	"strings"
	"time"

	"github.com/siyuan-note/dejavu"
	"github.com/siyuan-note/siyuan/kernel/bazaar"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// appearanceChangedPackages 将包文件的变更归并为需要刷新的包名。
func appearanceChangedPackages(result *dejavu.MergeResult) (themes, icons []string) {
	changed := map[string]map[string]bool{"themes": {}, "icons": {}}
	paths := make([]string, 0, len(result.Upserts)+len(result.Removes))
	for _, file := range result.Upserts {
		paths = append(paths, file.Path)
	}
	for _, file := range result.Removes {
		paths = append(paths, file.Path)
	}
	for _, filePath := range paths {
		parts := strings.Split(strings.TrimPrefix(filePath, "/"), "/")
		if len(parts) >= 3 && (parts[0] == "themes" || parts[0] == "icons") {
			changed[parts[0]][parts[1]] = true
		}
	}
	for name := range changed["themes"] {
		themes = append(themes, name)
	}
	for name := range changed["icons"] {
		icons = append(icons, name)
	}
	sort.Strings(themes)
	sort.Strings(icons)
	return
}

// refreshAppearancePackages 在同步或快照恢复之后重建本机外观列表，并通知各前端清除资源缓存。
func refreshAppearancePackages(themes, icons []string) {
	if len(themes)+len(icons) == 0 {
		return
	}
	CloseWatchThemes()
	defer WatchThemes()
	for _, name := range themes {
		bazaar.RemoveInstalledPackageSizeCache("themes", name)
	}
	for _, name := range icons {
		bazaar.RemoveInstalledPackageSizeCache("icons", name)
	}
	refreshAppearanceConfig()
	util.BroadcastByType("main", "refreshAppearance", 0, "", map[string]any{
		"appearance": Conf.Appearance, "themes": themes, "icons": icons,
		"revision": time.Now().UTC().Format("20060102150405.000000000"),
	})
}
