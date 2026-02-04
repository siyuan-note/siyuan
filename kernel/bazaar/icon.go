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

	"github.com/88250/go-humanize"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func InstalledIcons() (ret []*Package) {
	ret = []*Package{}

	if !util.IsPathRegularDirOrSymlinkDir(util.IconsPath) {
		return
	}

	iconDirs, err := os.ReadDir(util.IconsPath)
	if err != nil {
		logging.LogWarnf("read icons folder failed: %s", err)
		return
	}

	bazaarIcons := Packages("icons", "")

	for _, iconDir := range iconDirs {
		if !util.IsDirRegularOrSymlink(iconDir) {
			continue
		}
		dirName := iconDir.Name()
		if isBuiltInIcon(dirName) {
			continue
		}

		icon, parseErr := ParsePackageJSON("icon", dirName)
		if nil != parseErr || nil == icon {
			continue
		}

		icon.RepoURL = icon.URL
		icon.DisallowInstall = disallowInstallBazaarPackage(icon)
		if bazaarPkg := getBazaarPackageByName(bazaarIcons, icon.Name); nil != bazaarPkg {
			icon.DisallowUpdate = disallowInstallBazaarPackage(bazaarPkg)
			icon.UpdateRequiredMinAppVer = bazaarPkg.MinAppVersion
			icon.RepoURL = bazaarPkg.RepoURL
		}

		installPath := filepath.Join(util.IconsPath, dirName)
		icon.Installed = true
		icon.PreviewURL = "/appearance/icons/" + dirName + "/preview.png"
		icon.PreviewURLThumb = "/appearance/icons/" + dirName + "/preview.png"
		icon.IconURL = "/appearance/icons/" + dirName + "/icon.png"
		icon.PreferredFunding = getPreferredFunding(icon.Funding)
		icon.PreferredName = GetPreferredName(icon)
		icon.PreferredDesc = getPreferredDesc(icon.Description)
		info, statErr := os.Stat(filepath.Join(installPath, "icon.json"))
		if nil != statErr {
			logging.LogWarnf("stat install icon.json failed: %s", statErr)
			continue
		}
		icon.HInstallDate = info.ModTime().Format("2006-01-02")
		if installSize, ok := packageInstallSizeCache.Get(icon.RepoURL); ok {
			icon.InstallSize = installSize.(int64)
		} else {
			is, _ := util.SizeOfDirectory(installPath)
			icon.InstallSize = is
			packageInstallSizeCache.SetDefault(icon.RepoURL, is)
		}
		icon.HInstallSize = humanize.BytesCustomCeil(uint64(icon.InstallSize), 2)
		icon.PreferredReadme = loadInstalledReadme(installPath, "/appearance/icons/"+dirName+"/", icon.Readme)
		icon.Outdated = isOutdatedPackage(bazaarIcons, icon)
		ret = append(ret, icon)
	}
	return
}

func isBuiltInIcon(dirName string) bool {
	return "ant" == dirName || "material" == dirName
}
