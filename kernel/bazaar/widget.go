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

func InstalledWidgets() (ret []*Package) {
	ret = []*Package{}

	widgetsPath := filepath.Join(util.DataDir, "widgets")
	if !util.IsPathRegularDirOrSymlinkDir(widgetsPath) {
		return
	}

	widgetDirs, err := os.ReadDir(widgetsPath)
	if err != nil {
		logging.LogWarnf("read widgets folder failed: %s", err)
		return
	}

	bazaarWidgets := Packages("widgets", "")

	for _, widgetDir := range widgetDirs {
		if !util.IsDirRegularOrSymlink(widgetDir) {
			continue
		}
		dirName := widgetDir.Name()

		widget, parseErr := ParsePackageJSON("widget", dirName)
		if nil != parseErr || nil == widget {
			continue
		}

		widget.RepoURL = widget.URL
		widget.DisallowInstall = disallowInstallBazaarPackage(widget)
		if bazaarPkg := getBazaarPackageByName(bazaarWidgets, widget.Name); nil != bazaarPkg {
			widget.DisallowUpdate = disallowInstallBazaarPackage(bazaarPkg)
			widget.UpdateRequiredMinAppVer = bazaarPkg.MinAppVersion
			widget.RepoURL = bazaarPkg.RepoURL
		}

		installPath := filepath.Join(util.DataDir, "widgets", dirName)
		widget.Installed = true
		widget.PreviewURL = "/widgets/" + dirName + "/preview.png"
		widget.PreviewURLThumb = "/widgets/" + dirName + "/preview.png"
		widget.IconURL = "/widgets/" + dirName + "/icon.png"
		widget.PreferredFunding = getPreferredFunding(widget.Funding)
		widget.PreferredName = GetPreferredName(widget)
		widget.PreferredDesc = getPreferredDesc(widget.Description)
		info, statErr := os.Stat(filepath.Join(installPath, "widget.json"))
		if nil != statErr {
			logging.LogWarnf("stat install widget.json failed: %s", statErr)
			continue
		}
		widget.HInstallDate = info.ModTime().Format("2006-01-02")
		if installSize, ok := packageInstallSizeCache.Get(widget.RepoURL); ok {
			widget.InstallSize = installSize.(int64)
		} else {
			is, _ := util.SizeOfDirectory(installPath)
			widget.InstallSize = is
			packageInstallSizeCache.SetDefault(widget.RepoURL, is)
		}
		widget.HInstallSize = humanize.BytesCustomCeil(uint64(widget.InstallSize), 2)
		widget.PreferredReadme = loadInstalledReadme(installPath, "/widgets/"+dirName+"/", widget.Readme)
		widget.Outdated = isOutdatedPackage(bazaarWidgets, widget)
		ret = append(ret, widget)
	}
	return
}
