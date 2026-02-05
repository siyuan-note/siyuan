// SiYuan - Refactor your thinking
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

package bazaar

import (
	"os"
	"path/filepath"

	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func InstalledThemes() (ret []*Package) {
	ret = []*Package{}

	themeDirs, err := readInstalledPackageDirs(util.ThemesPath)
	if err != nil {
		logging.LogWarnf("read appearance themes folder failed: %s", err)
		return
	}
	if len(themeDirs) == 0 {
		return
	}

	// 过滤内置主题
	var filteredDirs []os.DirEntry
	for _, dir := range themeDirs {
		if !IsBuiltInTheme(dir.Name()) {
			filteredDirs = append(filteredDirs, dir)
		}
	}

	bazaarThemesMap := buildBazaarPackagesMap("themes", "")
	installedThemeInfos := getInstalledPackageInfos(filteredDirs, "theme")

	for _, info := range installedThemeInfos {
		theme := info.Pkg
		dirName := info.DirName
		installPath := filepath.Join(util.ThemesPath, dirName)

		if !setPackageMetadata(theme, installPath, "theme.json", "/appearance/themes/"+dirName, bazaarThemesMap) {
			continue
		}

		ret = append(ret, theme)
	}
	return
}

func IsBuiltInTheme(dirName string) bool {
	return "daylight" == dirName || "midnight" == dirName
}
