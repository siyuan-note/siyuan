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
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"

	"github.com/dustin/go-humanize"
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

	stageIndex, err := getStageIndex("themes")
	if nil != err {
		return
	}
	bazaarIndex := getBazaarIndex()
	waitGroup := &sync.WaitGroup{}
	lock := &sync.Mutex{}
	p, _ := ants.NewPoolWithFunc(8, func(arg interface{}) {
		defer waitGroup.Done()

		repo := arg.(*StageRepo)
		repoURL := repo.URL

		theme := &Theme{}
		innerU := util.BazaarOSSServer + "/package/" + repoURL + "/theme.json"
		innerResp, innerErr := httpclient.NewBrowserRequest().SetSuccessResult(theme).Get(innerU)
		if nil != innerErr {
			logging.LogErrorf("get bazaar package [%s] failed: %s", innerU, innerErr)
			return
		}
		if 200 != innerResp.StatusCode {
			logging.LogErrorf("get bazaar package [%s] failed: %d", innerU, innerResp.StatusCode)
			return
		}

		if disallowDisplayBazaarPackage(theme.Package) {
			return
		}

		theme.URL = strings.TrimSuffix(theme.URL, "/")
		repoURLHash := strings.Split(repoURL, "@")
		theme.RepoURL = "https://github.com/" + repoURLHash[0]
		theme.RepoHash = repoURLHash[1]
		theme.PreviewURL = util.BazaarOSSServer + "/package/" + repoURL + "/preview.png?imageslim"
		theme.PreviewURLThumb = util.BazaarOSSServer + "/package/" + repoURL + "/preview.png?imageView2/2/w/436/h/232"
		theme.IconURL = util.BazaarOSSServer + "/package/" + repoURL + "/icon.png"
		theme.Funding = repo.Package.Funding
		theme.PreferredFunding = getPreferredFunding(theme.Funding)
		theme.PreferredName = getPreferredName(theme.Package)
		theme.PreferredDesc = getPreferredDesc(theme.Description)
		theme.Updated = repo.Updated
		theme.Stars = repo.Stars
		theme.OpenIssues = repo.OpenIssues
		theme.Size = repo.Size
		theme.HSize = humanize.Bytes(uint64(theme.Size))
		theme.HUpdated = formatUpdated(theme.Updated)
		pkg := bazaarIndex[strings.Split(repoURL, "@")[0]]
		if nil != pkg {
			theme.Downloads = pkg.Downloads
		}
		lock.Lock()
		ret = append(ret, theme)
		lock.Unlock()
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
	if nil != err {
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

		installPath := filepath.Join(util.ThemesPath, dirName)

		theme.Installed = true
		theme.RepoURL = theme.URL
		theme.PreviewURL = "/appearance/themes/" + dirName + "/preview.png"
		theme.PreviewURLThumb = "/appearance/themes/" + dirName + "/preview.png"
		theme.IconURL = "/appearance/themes/" + dirName + "/icon.png"
		theme.PreferredFunding = getPreferredFunding(theme.Funding)
		theme.PreferredName = getPreferredName(theme.Package)
		theme.PreferredDesc = getPreferredDesc(theme.Description)
		info, statErr := os.Stat(filepath.Join(installPath, "README.md"))
		if nil != statErr {
			logging.LogWarnf("stat install theme README.md failed: %s", statErr)
			continue
		}
		theme.HInstallDate = info.ModTime().Format("2006-01-02")
		installSize, _ := util.SizeOfDirectory(installPath)
		theme.InstallSize = installSize
		theme.HInstallSize = humanize.Bytes(uint64(installSize))
		readmeFilename := getPreferredReadme(theme.Readme)
		readme, readErr := os.ReadFile(filepath.Join(installPath, readmeFilename))
		if nil != readErr {
			logging.LogWarnf("read installed README.md failed: %s", readErr)
			continue
		}

		theme.PreferredReadme, _ = renderREADME(theme.URL, readme)
		theme.Outdated = isOutdatedTheme(theme, bazaarThemes)
		ret = append(ret, theme)
	}
	return
}

func isBuiltInTheme(dirName string) bool {
	return "daylight" == dirName || "midnight" == dirName
}

func InstallTheme(repoURL, repoHash, installPath string, systemID string) error {
	repoURLHash := repoURL + "@" + repoHash
	data, err := downloadPackage(repoURLHash, true, systemID)
	if nil != err {
		return err
	}
	return installPackage(data, installPath)
}

func UninstallTheme(installPath string) error {
	if err := os.RemoveAll(installPath); nil != err {
		logging.LogErrorf("remove theme [%s] failed: %s", installPath, err)
		return errors.New("remove community theme failed")
	}
	//logging.Logger.Infof("uninstalled theme [%s]", installPath)
	return nil
}
