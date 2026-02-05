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
	"path/filepath"

	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func InstalledTemplates() (ret []*Package) {
	ret = []*Package{}

	templatesPath := filepath.Join(util.DataDir, "templates")
	templateDirs, err := readInstalledPackageDirs(templatesPath)
	if err != nil {
		logging.LogWarnf("read templates folder failed: %s", err)
		return
	}
	if len(templateDirs) == 0 {
		return
	}

	bazaarTemplatesMap := buildBazaarPackagesMap("templates", "")
	installedTemplateInfos := getInstalledPackageInfos(templateDirs, "template")

	for _, info := range installedTemplateInfos {
		template := info.Pkg
		dirName := info.DirName

		config := PackageMetadataConfig{
			BasePath:          templatesPath,
			DirName:           dirName,
			JSONFileName:      "template.json",
			BaseURLPath:       "/templates/" + dirName,
			BazaarPackagesMap: bazaarTemplatesMap,
		}

		if !setPackageMetadata(template, config) {
			continue
		}

		ret = append(ret, template)
	}
	return
}
