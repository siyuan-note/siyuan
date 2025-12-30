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
	"sync"

	"github.com/88250/go-humanize"
	ants "github.com/panjf2000/ants/v2"
	"github.com/siyuan-note/httpclient"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/util"
)

type Theme struct {
	*Package

	Modes []string `json:"modes"`
}

func Themes() (ret []*Theme) {
	ret = []*Theme{}

	isOnline := isBazzarOnline()
	if !isOnline {
		return
	}

	stageIndex, err := getStageIndex("themes")
	if err != nil {
		return
	}
	bazaarIndex := getBazaarIndex()
	if 1 > len(bazaarIndex) {
		return
	}

	requestFailed := false
	waitGroup := &sync.WaitGroup{}
	lock := &sync.Mutex{}
	p, _ := ants.NewPoolWithFunc(8, func(arg interface{}) {
		defer waitGroup.Done()

		repo := arg.(*StageRepo)
		repoURL := repo.URL

		if pkg, found := packageCache.Get(repoURL); found {
			lock.Lock()
			ret = append(ret, pkg.(*Theme))
			lock.Unlock()
			return
		}

		if requestFailed {
			return
		}

		theme := &Theme{}
		innerU := util.BazaarOSSServer + "/package/" + repoURL + "/theme.json"
		innerResp, innerErr := httpclient.NewBrowserRequest().SetSuccessResult(theme).Get(innerU)
		if nil != innerErr {
			logging.LogErrorf("get bazaar package [%s] failed: %s", innerU, innerErr)
			requestFailed = true
			return
		}
		if 200 != innerResp.StatusCode {
			logging.LogErrorf("get bazaar package [%s] failed: %d", innerU, innerResp.StatusCode)
			requestFailed = true
			return
		}

		theme.DisallowInstall = disallowInstallBazaarPackage(theme.Package)
		theme.DisallowUpdate = disallowInstallBazaarPackage(theme.Package)
		theme.UpdateRequiredMinAppVer = theme.MinAppVersion

		theme.URL = strings.TrimSuffix(theme.URL, "/")
		repoURLHash := strings.Split(repoURL, "@")
		theme.RepoURL = "https://github.com/" + repoURLHash[0]
		theme.RepoHash = repoURLHash[1]
		theme.PreviewURL = util.BazaarOSSServer + "/package/" + repoURL + "/preview.png?imageslim"
		theme.PreviewURLThumb = util.BazaarOSSServer + "/package/" + repoURL + "/preview.png?imageView2/2/w/436/h/232"
		theme.IconURL = util.BazaarOSSServer + "/package/" + repoURL + "/icon.png"
		theme.Funding = repo.Package.Funding
		theme.PreferredFunding = getPreferredFunding(theme.Funding)
		theme.PreferredName = GetPreferredName(theme.Package)
		theme.PreferredDesc = getPreferredDesc(theme.Description)
		theme.Updated = repo.Updated
		theme.Stars = repo.Stars
		theme.OpenIssues = repo.OpenIssues
		theme.Size = repo.Size
		theme.HSize = humanize.BytesCustomCeil(uint64(theme.Size), 2)
		theme.InstallSize = repo.InstallSize
		theme.HInstallSize = humanize.BytesCustomCeil(uint64(theme.InstallSize), 2)
		packageInstallSizeCache.SetDefault(theme.RepoURL, theme.InstallSize)
		theme.HUpdated = formatUpdated(theme.Updated)
		pkg := bazaarIndex[strings.Split(repoURL, "@")[0]]
		if nil != pkg {
			theme.Downloads = pkg.Downloads
		}
		lock.Lock()
		ret = append(ret, theme)
		lock.Unlock()

		packageCache.SetDefault(repoURL, theme)
	})
	for _, repo := range stageIndex.Repos {
		waitGroup.Add(1)
		p.Invoke(repo)
	}
	waitGroup.Wait()
	p.Release()

	sort.Slice(ret, func(i, j int) bool { return ret[i].Updated > ret[j].Updated })
	return
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

		theme.DisallowInstall = disallowInstallBazaarPackage(theme.Package)
		if bazaarPkg := getBazaarTheme(theme.Name, bazaarThemes); nil != bazaarPkg {
			theme.DisallowUpdate = disallowInstallBazaarPackage(bazaarPkg.Package)
			theme.UpdateRequiredMinAppVer = bazaarPkg.MinAppVersion
		}

		installPath := filepath.Join(util.ThemesPath, dirName)
		theme.Installed = true
		theme.RepoURL = theme.URL
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
