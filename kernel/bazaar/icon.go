// SiYuan - Build Your Eternal Digital Garden
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

type Icon struct {
	Package
}

func Icons() (icons []*Icon) {
	icons = []*Icon{}

	pkgIndex, err := getPkgIndex("icons")
	if nil != err {
		return
	}
	bazaarIndex := getBazaarIndex()
	repos := pkgIndex["repos"].([]interface{})
	waitGroup := &sync.WaitGroup{}
	lock := &sync.Mutex{}
	p, _ := ants.NewPoolWithFunc(2, func(arg interface{}) {
		defer waitGroup.Done()

		repo := arg.(map[string]interface{})
		repoURL := repo["url"].(string)

		icon := &Icon{}
		innerU := util.BazaarOSSServer + "/package/" + repoURL + "/icon.json"
		innerResp, innerErr := httpclient.NewBrowserRequest().SetResult(icon).Get(innerU)
		if nil != innerErr {
			logging.LogErrorf("get bazaar package [%s] failed: %s", repoURL, innerErr)
			return
		}
		if 200 != innerResp.StatusCode {
			logging.LogErrorf("get bazaar package [%s] failed: %d", innerU, innerResp.StatusCode)
			return
		}

		repoURLHash := strings.Split(repoURL, "@")
		icon.RepoURL = "https://github.com/" + repoURLHash[0]
		icon.RepoHash = repoURLHash[1]
		icon.PreviewURL = util.BazaarOSSServer + "/package/" + repoURL + "/preview.png?imageslim"
		icon.PreviewURLThumb = util.BazaarOSSServer + "/package/" + repoURL + "/preview.png?imageView2/2/w/436/h/232"
		icon.Updated = repo["updated"].(string)
		icon.Stars = int(repo["stars"].(float64))
		icon.OpenIssues = int(repo["openIssues"].(float64))
		icon.Size = int64(repo["size"].(float64))
		icon.HSize = humanize.Bytes(uint64(icon.Size))
		icon.HUpdated = formatUpdated(icon.Updated)
		pkg := bazaarIndex[strings.Split(repoURL, "@")[0]]
		if nil != pkg {
			icon.Downloads = pkg.Downloads
		}
		lock.Lock()
		icons = append(icons, icon)
		lock.Unlock()
	})
	for _, repo := range repos {
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
	iconDirs, err := os.ReadDir(util.IconsPath)
	if nil != err {
		logging.LogWarnf("read icons folder failed: %s", err)
		return
	}

	bazaarIcons := Icons()

	for _, iconDir := range iconDirs {
		if !iconDir.IsDir() {
			continue
		}
		dirName := iconDir.Name()
		if isBuiltInIcon(dirName) {
			continue
		}

		iconConf, parseErr := IconJSON(dirName)
		if nil != parseErr || nil == iconConf {
			continue
		}

		installPath := filepath.Join(util.IconsPath, dirName)

		icon := &Icon{}
		icon.Installed = true
		icon.Name = iconConf["name"].(string)
		icon.Author = iconConf["author"].(string)
		icon.URL = iconConf["url"].(string)
		icon.Version = iconConf["version"].(string)
		icon.RepoURL = icon.URL
		icon.PreviewURL = "/appearance/icons/" + dirName + "/preview.png"
		icon.PreviewURLThumb = "/appearance/icons/" + dirName + "/preview.png"
		info, statErr := os.Stat(filepath.Join(installPath, "README.md"))
		if nil != statErr {
			logging.LogWarnf("stat install theme README.md failed: %s", statErr)
			continue
		}
		icon.HInstallDate = info.ModTime().Format("2006-01-02")
		installSize, _ := util.SizeOfDirectory(installPath)
		icon.InstallSize = installSize
		icon.HInstallSize = humanize.Bytes(uint64(installSize))
		readme, readErr := os.ReadFile(filepath.Join(installPath, "README.md"))
		if nil != readErr {
			logging.LogWarnf("read install icon README.md failed: %s", readErr)
			continue
		}

		icon.README, _ = renderREADME(icon.URL, readme)
		icon.Outdated = isOutdatedIcon(icon, bazaarIcons)
		ret = append(ret, icon)
	}
	return
}

func isBuiltInIcon(dirName string) bool {
	return "ant" == dirName || "material" == dirName
}

func InstallIcon(repoURL, repoHash, installPath string, systemID string) error {
	repoURLHash := repoURL + "@" + repoHash
	data, err := downloadPackage(repoURLHash, true, systemID)
	if nil != err {
		return err
	}
	return installPackage(data, installPath)
}

func UninstallIcon(installPath string) error {
	if err := os.RemoveAll(installPath); nil != err {
		logging.LogErrorf("remove icon [%s] failed: %s", installPath, err)
		return errors.New("remove community icon failed")
	}
	//logging.Logger.Infof("uninstalled icon [%s]", installPath)
	return nil
}
