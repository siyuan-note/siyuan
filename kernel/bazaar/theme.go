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

type Theme struct {
	*Package

	Modes []string `json:"modes"`
}

// Themes 返回集市主题列表
func Themes() (ret []*Theme) {
	ret = []*Theme{}
	result := getStageAndBazaar("themes")

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
		theme := buildThemeFromStageRepo(repo, result.BazaarIndex)
		if nil != theme {
			ret = append(ret, theme)
		}
	}

	sort.Slice(ret, func(i, j int) bool { return ret[i].Updated > ret[j].Updated })
	return
}

// buildThemeFromStageRepo 使用 stage 内嵌的 package 构建 *Theme，不发起 HTTP 请求。
func buildThemeFromStageRepo(repo *StageRepo, bazaarIndex map[string]*bazaarPackage) *Theme {
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
	theme := &Theme{Package: &pkg, Modes: []string{}}
	return theme
}

func InstalledThemes() (ret []*Theme) {
	ret = []*Theme{}

	if !util.IsPathRegularDirOrSymlinkDir(util.ThemesPath) {
		return
	}

	themeDirs, err := os.ReadDir(util.ThemesPath)
	if err != nil {
		logging.LogWarnf("read appearance themes folder failed: %s", err)
		return
	}

	bazaarThemes := Themes()

	for _, themeDir := range themeDirs {
		if !util.IsDirRegularOrSymlink(themeDir) {
			continue
		}
		dirName := themeDir.Name()
		if isBuiltInTheme(dirName) {
			continue
		}

		theme, parseErr := ThemeJSON(dirName)
		if nil != parseErr || nil == theme {
			continue
		}

		theme.RepoURL = theme.URL
		theme.DisallowInstall = disallowInstallBazaarPackage(theme.Package)
		if bazaarPkg := getBazaarTheme(theme.Name, bazaarThemes); nil != bazaarPkg {
			theme.DisallowUpdate = disallowInstallBazaarPackage(bazaarPkg.Package)
			theme.UpdateRequiredMinAppVer = bazaarPkg.MinAppVersion
			theme.RepoURL = bazaarPkg.RepoURL
		}

		installPath := filepath.Join(util.ThemesPath, dirName)
		theme.Installed = true
		theme.PreviewURL = "/appearance/themes/" + dirName + "/preview.png"
		theme.PreviewURLThumb = "/appearance/themes/" + dirName + "/preview.png"
		theme.IconURL = "/appearance/themes/" + dirName + "/icon.png"
		theme.PreferredFunding = getPreferredFunding(theme.Funding)
		theme.PreferredName = GetPreferredName(theme.Package)
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
		theme.Outdated = isOutdatedTheme(theme, bazaarThemes)
		ret = append(ret, theme)
	}
	return
}

func isBuiltInTheme(dirName string) bool {
	return "daylight" == dirName || "midnight" == dirName
}

func getBazaarTheme(name string, themes []*Theme) *Theme {
	for _, p := range themes {
		if p.Name == name {
			return p
		}
	}
	return nil
}

func InstallTheme(repoURL, repoHash, installPath string, systemID string) error {
	repoURLHash := repoURL + "@" + repoHash
	data, err := downloadPackage(repoURLHash, true, systemID)
	if err != nil {
		return err
	}
	return installPackage(data, installPath, repoURLHash)
}

func UninstallTheme(installPath string) error {
	return uninstallPackage(installPath)
}
