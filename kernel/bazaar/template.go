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

func InstalledTemplates() (ret []*Package) {
	ret = []*Package{}

	templatesPath := filepath.Join(util.DataDir, "templates")
	if !util.IsPathRegularDirOrSymlinkDir(templatesPath) {
		return
	}

	templateDirs, err := os.ReadDir(templatesPath)
	if err != nil {
		logging.LogWarnf("read templates folder failed: %s", err)
		return
	}

	bazaarTemplates := Packages("templates", "")

	for _, templateDir := range templateDirs {
		if !util.IsDirRegularOrSymlink(templateDir) {
			continue
		}
		dirName := templateDir.Name()

		template, parseErr := ParsePackageJSON("template", dirName)
		if nil != parseErr || nil == template {
			continue
		}

		template.RepoURL = template.URL
		template.DisallowInstall = disallowInstallBazaarPackage(template)
		if bazaarPkg := getBazaarPackageByName(bazaarTemplates, template.Name); nil != bazaarPkg {
			template.DisallowUpdate = disallowInstallBazaarPackage(bazaarPkg)
			template.UpdateRequiredMinAppVer = bazaarPkg.MinAppVersion
			template.RepoURL = bazaarPkg.RepoURL
		}

		installPath := filepath.Join(util.DataDir, "templates", dirName)
		template.Installed = true
		template.PreviewURL = "/templates/" + dirName + "/preview.png"
		template.PreviewURLThumb = "/templates/" + dirName + "/preview.png"
		template.IconURL = "/templates/" + dirName + "/icon.png"
		template.PreferredFunding = getPreferredFunding(template.Funding)
		template.PreferredName = GetPreferredName(template)
		template.PreferredDesc = getPreferredDesc(template.Description)
		info, statErr := os.Stat(filepath.Join(installPath, "template.json"))
		if nil != statErr {
			logging.LogWarnf("stat install template.json failed: %s", statErr)
			continue
		}
		template.HInstallDate = info.ModTime().Format("2006-01-02")
		if installSize, ok := packageInstallSizeCache.Get(template.RepoURL); ok {
			template.InstallSize = installSize.(int64)
		} else {
			is, _ := util.SizeOfDirectory(installPath)
			template.InstallSize = is
			packageInstallSizeCache.SetDefault(template.RepoURL, is)
		}
		template.HInstallSize = humanize.BytesCustomCeil(uint64(template.InstallSize), 2)
		template.PreferredReadme = loadInstalledReadme(installPath, "/templates/"+dirName+"/", template.Readme)
		template.Outdated = isOutdatedPackage(bazaarTemplates, template)
		ret = append(ret, template)
	}
	return
}
