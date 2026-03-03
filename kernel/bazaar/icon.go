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
	"sort"
	"strings"

	"github.com/88250/go-humanize"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/util"
)

type Icon struct {
	*Package
}

// Icons 返回集市图标列表
func Icons() (icons []*Icon) {
	icons = []*Icon{}
	result := getStageAndBazaar("icons")

	if !result.Online {
		return
	}
	if result.StageErr != nil {
		return
	}
	if 1 > len(result.BazaarIndex) {
		return
	}

	for _, repo := range result.StageIndex.Repos {
		if nil == repo.Package {
			continue
		}
		icon := buildIconFromStageRepo(repo, result.BazaarIndex)
		if nil != icon {
			icons = append(icons, icon)
		}
	}

	sort.Slice(icons, func(i, j int) bool { return icons[i].Updated > icons[j].Updated })
	return
}

// buildIconFromStageRepo 使用 stage 内嵌的 package 构建 *Icon，不发起 HTTP 请求。
func buildIconFromStageRepo(repo *StageRepo, bazaarIndex map[string]*bazaarPackage) *Icon {
	pkg := *repo.Package
	pkg.URL = strings.TrimSuffix(pkg.URL, "/")
	repoURLHash := strings.Split(repo.URL, "@")
	if 2 != len(repoURLHash) {
		return nil
	}
	pkg.RepoURL = "https://github.com/" + repoURLHash[0]
	pkg.RepoHash = repoURLHash[1]
	pkg.PreviewURL = util.BazaarOSSServer + "/package/" + repo.URL + "/preview.png?imageslim"
	pkg.PreviewURLThumb = util.BazaarOSSServer + "/package/" + repo.URL + "/preview.png?imageView2/2/w/436/h/232"
	pkg.IconURL = util.BazaarOSSServer + "/package/" + repo.URL + "/icon.png"
	pkg.Updated = repo.Updated
	pkg.Stars = repo.Stars
	pkg.OpenIssues = repo.OpenIssues
	pkg.Size = repo.Size
	pkg.HSize = humanize.BytesCustomCeil(uint64(pkg.Size), 2)
	pkg.InstallSize = repo.InstallSize
	pkg.HInstallSize = humanize.BytesCustomCeil(uint64(pkg.InstallSize), 2)
	pkg.HUpdated = formatUpdated(pkg.Updated)
	pkg.PreferredFunding = getPreferredFunding(pkg.Funding)
	pkg.PreferredName = GetPreferredName(&pkg)
	pkg.PreferredDesc = getPreferredDesc(pkg.Description)
	pkg.DisallowInstall = disallowInstallBazaarPackage(&pkg)
	pkg.DisallowUpdate = disallowInstallBazaarPackage(&pkg)
	pkg.UpdateRequiredMinAppVer = pkg.MinAppVersion
	if bp := bazaarIndex[repoURLHash[0]]; nil != bp {
		pkg.Downloads = bp.Downloads
	}
	packageInstallSizeCache.SetDefault(pkg.RepoURL, pkg.InstallSize)
	return &Icon{Package: &pkg}
}

func InstalledIcons() (ret []*Icon) {
	ret = []*Icon{}

	if !util.IsPathRegularDirOrSymlinkDir(util.IconsPath) {
		return
	}

	iconDirs, err := os.ReadDir(util.IconsPath)
	if err != nil {
		logging.LogWarnf("read icons folder failed: %s", err)
		return
	}

	bazaarIcons := Icons()

	for _, iconDir := range iconDirs {
		if !util.IsDirRegularOrSymlink(iconDir) {
			continue
		}
		dirName := iconDir.Name()
		if isBuiltInIcon(dirName) {
			continue
		}

		icon, parseErr := IconJSON(dirName)
		if nil != parseErr || nil == icon {
			continue
		}

		icon.RepoURL = icon.URL
		icon.DisallowInstall = disallowInstallBazaarPackage(icon.Package)
		if bazaarPkg := getBazaarIcon(icon.Name, bazaarIcons); nil != bazaarPkg {
			icon.DisallowUpdate = disallowInstallBazaarPackage(bazaarPkg.Package)
			icon.UpdateRequiredMinAppVer = bazaarPkg.MinAppVersion
			icon.RepoURL = bazaarPkg.RepoURL
		}

		installPath := filepath.Join(util.IconsPath, dirName)
		icon.Installed = true
		icon.PreviewURL = "/appearance/icons/" + dirName + "/preview.png"
		icon.PreviewURLThumb = "/appearance/icons/" + dirName + "/preview.png"
		icon.IconURL = "/appearance/icons/" + dirName + "/icon.png"
		icon.PreferredFunding = getPreferredFunding(icon.Funding)
		icon.PreferredName = GetPreferredName(icon.Package)
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
		icon.Outdated = isOutdatedIcon(icon, bazaarIcons)
		ret = append(ret, icon)
	}
	return
}

func isBuiltInIcon(dirName string) bool {
	return "ant" == dirName || "material" == dirName
}

func getBazaarIcon(name string, icon []*Icon) *Icon {
	for _, p := range icon {
		if p.Name == name {
			return p
		}
	}
	return nil
}

func InstallIcon(repoURL, repoHash, installPath string, systemID string) error {
	repoURLHash := repoURL + "@" + repoHash
	data, err := downloadPackage(repoURLHash, true, systemID)
	if err != nil {
		return err
	}
	return installPackage(data, installPath, repoURLHash)
}

func UninstallIcon(installPath string) error {
	return uninstallPackage(installPath)
}
