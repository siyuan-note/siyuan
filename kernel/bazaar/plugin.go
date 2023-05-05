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

	"github.com/88250/gulu"
	"github.com/dustin/go-humanize"
	ants "github.com/panjf2000/ants/v2"
	"github.com/siyuan-note/httpclient"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/util"
)

type Plugin struct {
	Package
}

func Plugins() (plugins []*Plugin) {
	plugins = []*Plugin{}

	pkgIndex, err := getPkgIndex("plugins")
	if nil != err {
		return
	}
	bazaarIndex := getBazaarIndex()

	repos := pkgIndex["repos"].([]interface{})
	waitGroup := &sync.WaitGroup{}
	lock := &sync.Mutex{}
	p, _ := ants.NewPoolWithFunc(8, func(arg interface{}) {
		defer waitGroup.Done()

		repo := arg.(map[string]interface{})
		repoURL := repo["url"].(string)

		plugin := &Plugin{}
		innerU := util.BazaarOSSServer + "/package/" + repoURL + "/plugin.json"
		innerResp, innerErr := httpclient.NewBrowserRequest().SetSuccessResult(plugin).Get(innerU)
		if nil != innerErr {
			logging.LogErrorf("get bazaar package [%s] failed: %s", repoURL, innerErr)
			return
		}
		if 200 != innerResp.StatusCode {
			logging.LogErrorf("get bazaar package [%s] failed: %d", innerU, innerResp.StatusCode)
			return
		}
		plugin.URL = strings.TrimSuffix(plugin.URL, "/")

		repoURLHash := strings.Split(repoURL, "@")
		plugin.RepoURL = "https://github.com/" + repoURLHash[0]
		plugin.RepoHash = repoURLHash[1]
		plugin.PreviewURL = util.BazaarOSSServer + "/package/" + repoURL + "/preview.png?imageslim"
		plugin.PreviewURLThumb = util.BazaarOSSServer + "/package/" + repoURL + "/preview.png?imageView2/2/w/436/h/232"
		plugin.Updated = repo["updated"].(string)
		plugin.Stars = int(repo["stars"].(float64))
		plugin.OpenIssues = int(repo["openIssues"].(float64))
		plugin.Size = int64(repo["size"].(float64))
		plugin.HSize = humanize.Bytes(uint64(plugin.Size))
		plugin.HUpdated = formatUpdated(plugin.Updated)
		pkg := bazaarIndex[strings.Split(repoURL, "@")[0]]
		if nil != pkg {
			plugin.Downloads = pkg.Downloads
		}
		lock.Lock()
		plugins = append(plugins, plugin)
		lock.Unlock()
	})
	for _, repo := range repos {
		waitGroup.Add(1)
		p.Invoke(repo)
	}
	waitGroup.Wait()
	p.Release()

	sort.Slice(plugins, func(i, j int) bool { return plugins[i].Updated > plugins[j].Updated })
	return
}

func InstalledPlugins() (ret []*Plugin) {
	ret = []*Plugin{}

	pluginsPath := filepath.Join(util.DataDir, "plugins")
	if !gulu.File.IsDir(pluginsPath) {
		return
	}

	pluginDirs, err := os.ReadDir(pluginsPath)
	if nil != err {
		logging.LogWarnf("read plugins folder failed: %s", err)
		return
	}

	bazaarPlugins := Plugins()

	for _, pluginDir := range pluginDirs {
		if !pluginDir.IsDir() {
			continue
		}
		dirName := pluginDir.Name()

		pluginConf, parseErr := PluginJSON(dirName)
		if nil != parseErr || nil == pluginConf {
			continue
		}

		installPath := filepath.Join(util.DataDir, "plugins", dirName)

		plugin := &Plugin{}
		plugin.Installed = true
		plugin.Name = pluginConf["name"].(string)
		plugin.Author = pluginConf["author"].(string)
		plugin.URL = pluginConf["url"].(string)
		plugin.URL = strings.TrimSuffix(plugin.URL, "/")
		plugin.Version = pluginConf["version"].(string)
		plugin.RepoURL = plugin.URL
		plugin.PreviewURL = "/plugins/" + dirName + "/preview.png"
		plugin.PreviewURLThumb = "/plugins/" + dirName + "/preview.png"
		info, statErr := os.Stat(filepath.Join(installPath, "README.md"))
		if nil != statErr {
			logging.LogWarnf("stat install theme README.md failed: %s", statErr)
			continue
		}
		plugin.HInstallDate = info.ModTime().Format("2006-01-02")
		installSize, _ := util.SizeOfDirectory(installPath)
		plugin.InstallSize = installSize
		plugin.HInstallSize = humanize.Bytes(uint64(installSize))
		readme, readErr := os.ReadFile(filepath.Join(installPath, "README.md"))
		if nil != readErr {
			logging.LogWarnf("read install plugin README.md failed: %s", readErr)
			continue
		}
		plugin.README, _ = renderREADME(plugin.URL, readme)
		plugin.Outdated = isOutdatedPlugin(plugin, bazaarPlugins)
		ret = append(ret, plugin)
	}
	return
}

func InstallPlugin(repoURL, repoHash, installPath string, systemID string) error {
	repoURLHash := repoURL + "@" + repoHash
	data, err := downloadPackage(repoURLHash, true, systemID)
	if nil != err {
		return err
	}
	return installPackage(data, installPath)
}

func UninstallPlugin(installPath string) error {
	if err := os.RemoveAll(installPath); nil != err {
		logging.LogErrorf("remove plugin [%s] failed: %s", installPath, err)
		return errors.New("remove community plugin failed")
	}
	//logging.Logger.Infof("uninstalled plugin [%s]", installPath)
	return nil
}
