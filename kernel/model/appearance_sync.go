package model

import (
	"path/filepath"
	"sort"
	"strings"
	"time"

	ignore "github.com/sabhiram/go-gitignore"
	"github.com/siyuan-note/dejavu"
	"github.com/siyuan-note/siyuan/kernel/bazaar"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// appearanceChangedPackages 将包内容和状态文件的变更归并为需要刷新的包名。
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
		} else if len(parts) == 4 && parts[0] == "storage" && parts[1] == "bazaar" &&
			(parts[2] == "themes" || parts[2] == "icons") && strings.HasSuffix(parts[3], ".json") {
			changed[parts[2]][strings.TrimSuffix(parts[3], ".json")] = true
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

// refreshAppearancePackages 只在整包发布之后重建本机外观列表，并通知各前端清除资源缓存。
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

// appearanceStatePayloadPath 为忽略规则提供与包状态对应的目录路径。
func appearanceStatePayloadPath(rel string) string {
	parts := strings.Split(strings.TrimPrefix(filepath.ToSlash(rel), "/"), "/")
	if len(parts) == 4 && parts[0] == "storage" && parts[1] == "bazaar" &&
		(parts[2] == "themes" || parts[2] == "icons") && strings.HasSuffix(parts[3], ".json") {
		return parts[2] + "/" + strings.TrimSuffix(parts[3], ".json") + "/"
	}
	return ""
}

func prepareAppearancePackages() error {
	if err := util.EnsureAppearanceSyncIsolation(); err != nil {
		return err
	}
	lines, err := loadAppearanceSyncIgnoreLines()
	if err != nil {
		return err
	}
	matcher := ignore.CompileIgnoreLines(lines...)
	return bazaar.PrepareAppearancePackages(func(kind, name string) bool {
		return matcher.MatchesPath(kind + "/" + name + "/")
	})
}
