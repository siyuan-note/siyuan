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

func InstalledIcons() (ret []*Package) {
	ret = []*Package{}

	iconDirs, err := readInstalledPackageDirs(util.IconsPath)
	if err != nil {
		logging.LogWarnf("read icons folder failed: %s", err)
		return
	}
	if len(iconDirs) == 0 {
		return
	}

	// 过滤内置图标
	var filteredDirs []os.DirEntry
	for _, dir := range iconDirs {
		if !isBuiltInIcon(dir.Name()) {
			filteredDirs = append(filteredDirs, dir)
		}
	}

	bazaarIconsMap := buildBazaarPackagesMap("icons", "")
	installedIconInfos := getInstalledPackageInfos(filteredDirs, "icon")

	for _, info := range installedIconInfos {
		icon := info.Pkg
		dirName := info.DirName
		installPath := filepath.Join(util.IconsPath, dirName)

		if !setPackageMetadata(icon, installPath, "icon.json", "/appearance/icons/"+dirName, bazaarIconsMap) {
			continue
		}

		ret = append(ret, icon)
	}
	return
}

func isBuiltInIcon(dirName string) bool {
	return "ant" == dirName || "material" == dirName
}
