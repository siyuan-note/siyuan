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

type Icon struct {
	*Package
}

func Icons() (icons []*Icon) {
	icons = []*Icon{}

	isOnline := isBazzarOnline()
	if !isOnline {
		return
	}

	stageIndex, err := getStageIndex("icons")
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
	p, _ := ants.NewPoolWithFunc(2, func(arg interface{}) {
		defer waitGroup.Done()

		repo := arg.(*StageRepo)
		repoURL := repo.URL

		if pkg, found := packageCache.Get(repoURL); found {
			lock.Lock()
			icons = append(icons, pkg.(*Icon))
			lock.Unlock()
			return
		}

		if requestFailed {
			return
		}

		icon := &Icon{}
		innerU := util.BazaarOSSServer + "/package/" + repoURL + "/icon.json"
		innerResp, innerErr := httpclient.NewBrowserRequest().SetSuccessResult(icon).Get(innerU)
		if nil != innerErr {
			logging.LogErrorf("get bazaar package [%s] failed: %s", repoURL, innerErr)
			requestFailed = true
			return
		}
		if 200 != innerResp.StatusCode {
			logging.LogErrorf("get bazaar package [%s] failed: %d", innerU, innerResp.StatusCode)
			requestFailed = true
			return
		}

		icon.DisallowInstall = disallowInstallBazaarPackage(icon.Package)
		icon.DisallowUpdate = disallowInstallBazaarPackage(icon.Package)
		icon.UpdateRequiredMinAppVer = icon.MinAppVersion

		icon.URL = strings.TrimSuffix(icon.URL, "/")
		repoURLHash := strings.Split(repoURL, "@")
		icon.RepoURL = "https://github.com/" + repoURLHash[0]
		icon.RepoHash = repoURLHash[1]
		icon.PreviewURL = util.BazaarOSSServer + "/package/" + repoURL + "/preview.png?imageslim"
		icon.PreviewURLThumb = util.BazaarOSSServer + "/package/" + repoURL + "/preview.png?imageView2/2/w/436/h/232"
		icon.IconURL = util.BazaarOSSServer + "/package/" + repoURL + "/icon.png"
		icon.Funding = repo.Package.Funding
		icon.PreferredFunding = getPreferredFunding(icon.Funding)
		icon.PreferredName = GetPreferredName(icon.Package)
		icon.PreferredDesc = getPreferredDesc(icon.Description)
		icon.Updated = repo.Updated
		icon.Stars = repo.Stars
		icon.OpenIssues = repo.OpenIssues
		icon.Size = repo.Size
		icon.HSize = humanize.BytesCustomCeil(uint64(icon.Size), 2)
		icon.InstallSize = repo.InstallSize
		icon.HInstallSize = humanize.BytesCustomCeil(uint64(icon.InstallSize), 2)
		packageInstallSizeCache.SetDefault(icon.RepoURL, icon.InstallSize)
		icon.HUpdated = formatUpdated(icon.Updated)
		pkg := bazaarIndex[strings.Split(repoURL, "@")[0]]
		if nil != pkg {
			icon.Downloads = pkg.Downloads
		}
		lock.Lock()
		icons = append(icons, icon)
		lock.Unlock()

		packageCache.SetDefault(repoURL, icon)
	})
	for _, repo := range stageIndex.Repos {
		waitGroup.Add(1)
		p.Invoke(repo)
	}
	waitGroup.Wait()
	p.Release()

	sort.Slice(icons, func(i, j int) bool { return icons[i].Updated > icons[j].Updated })
	return
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

		icon.DisallowInstall = disallowInstallBazaarPackage(icon.Package)
		if bazaarPkg := getBazaarIcon(icon.Name, bazaarIcons); nil != bazaarPkg {
			icon.DisallowUpdate = disallowInstallBazaarPackage(bazaarPkg.Package)
			icon.UpdateRequiredMinAppVer = bazaarPkg.MinAppVersion
		}

		installPath := filepath.Join(util.IconsPath, dirName)
		icon.Installed = true
		icon.RepoURL = icon.URL
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
