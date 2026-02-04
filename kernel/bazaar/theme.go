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

func InstalledThemes() (ret []*Package) {
	ret = []*Package{}

	if !util.IsPathRegularDirOrSymlinkDir(util.ThemesPath) {
		return
	}

	themeDirs, err := os.ReadDir(util.ThemesPath)
	if err != nil {
		logging.LogWarnf("read appearance themes folder failed: %s", err)
		return
	}

	bazaarThemes := Packages("themes", "")

	for _, themeDir := range themeDirs {
		if !util.IsDirRegularOrSymlink(themeDir) {
			continue
		}
		dirName := themeDir.Name()
		if IsBuiltInTheme(dirName) {
			continue
		}

		theme, parseErr := ParsePackageJSON("theme", dirName)
		if nil != parseErr || nil == theme {
			continue
		}

		theme.RepoURL = theme.URL
		theme.DisallowInstall = disallowInstallBazaarPackage(theme)
		if bazaarPkg := getBazaarPackageByName(bazaarThemes, theme.Name); nil != bazaarPkg {
			theme.DisallowUpdate = disallowInstallBazaarPackage(bazaarPkg)
			theme.UpdateRequiredMinAppVer = bazaarPkg.MinAppVersion
			theme.RepoURL = bazaarPkg.RepoURL
		}

		installPath := filepath.Join(util.ThemesPath, dirName)
		theme.Installed = true
		theme.PreviewURL = "/appearance/themes/" + dirName + "/preview.png"
		theme.PreviewURLThumb = "/appearance/themes/" + dirName + "/preview.png"
		theme.IconURL = "/appearance/themes/" + dirName + "/icon.png"
		theme.PreferredFunding = getPreferredFunding(theme.Funding)
		theme.PreferredName = GetPreferredName(theme)
		theme.PreferredDesc = getPreferredDesc(theme.Description)
		info, statErr := os.Stat(filepath.Join(installPath, "theme.json"))
		if nil != statErr {
			logging.LogWarnf("stat install theme.json failed: %s", statErr)
			continue
		}
		theme.HInstallDate = info.ModTime().Format("2006-01-02")
		if installSize, ok := packageInstallSizeCache.Get(theme.RepoURL); ok {
			theme.InstallSize = installSize.(int64)
		} else {
			is, _ := util.SizeOfDirectory(installPath)
			theme.InstallSize = is
			packageInstallSizeCache.SetDefault(theme.RepoURL, is)
		}
		theme.HInstallSize = humanize.BytesCustomCeil(uint64(theme.InstallSize), 2)
		theme.PreferredReadme = loadInstalledReadme(installPath, "/appearance/themes/"+dirName+"/", theme.Readme)
		theme.Outdated = isOutdatedPackage(bazaarThemes, theme)
		ret = append(ret, theme)
	}
	return
}

func IsBuiltInTheme(dirName string) bool {
	return "daylight" == dirName || "midnight" == dirName
}
