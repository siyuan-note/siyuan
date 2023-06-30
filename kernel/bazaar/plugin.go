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
	"runtime"
	"sort"
	"strings"
	"sync"

	"github.com/dustin/go-humanize"
	ants "github.com/panjf2000/ants/v2"
	"github.com/siyuan-note/httpclient"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/util"
)

type Plugin struct {
	*Package
	Enabled bool `json:"enabled"`
}

func Plugins(frontend string) (plugins []*Plugin) {
	plugins = []*Plugin{}

	stageIndex, err := getStageIndex("plugins")
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

		if disallowDisplayBazaarPackage(plugin.Package) {
			return
		}

		plugin.Incompatible = isIncompatiblePlugin(plugin, frontend)

		plugin.URL = strings.TrimSuffix(plugin.URL, "/")
		repoURLHash := strings.Split(repoURL, "@")
		plugin.RepoURL = "https://github.com/" + repoURLHash[0]
		plugin.RepoHash = repoURLHash[1]
		plugin.PreviewURL = util.BazaarOSSServer + "/package/" + repoURL + "/preview.png?imageslim"
		plugin.PreviewURLThumb = util.BazaarOSSServer + "/package/" + repoURL + "/preview.png?imageView2/2/w/436/h/232"
		plugin.IconURL = util.BazaarOSSServer + "/package/" + repoURL + "/icon.png"
		plugin.Funding = repo.Package.Funding
		plugin.PreferredFunding = getPreferredFunding(plugin.Funding)
		plugin.PreferredName = getPreferredName(plugin.Package)
		plugin.PreferredDesc = getPreferredDesc(plugin.Description)
		plugin.Updated = repo.Updated
		plugin.Stars = repo.Stars
		plugin.OpenIssues = repo.OpenIssues
		plugin.Size = repo.Size
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
	for _, repo := range stageIndex.Repos {
		waitGroup.Add(1)
		p.Invoke(repo)
	}
	waitGroup.Wait()
	p.Release()

	sort.Slice(plugins, func(i, j int) bool { return plugins[i].Updated > plugins[j].Updated })
	return
}

func ParseInstalledPlugin(name, frontend string) (found bool, displayName string, incompatible bool) {
	pluginsPath := filepath.Join(util.DataDir, "plugins")
	if !util.IsPathRegularDirOrSymlinkDir(pluginsPath) {
		return
	}

	pluginDirs, err := os.ReadDir(pluginsPath)
	if nil != err {
		logging.LogWarnf("read plugins folder failed: %s", err)
		return
	}

	for _, pluginDir := range pluginDirs {
		if !util.IsDirRegularOrSymlink(pluginDir) {
			continue
		}
		dirName := pluginDir.Name()
		if name != dirName {
			continue
		}

		plugin, parseErr := PluginJSON(dirName)
		if nil != parseErr || nil == plugin {
			return
		}

		found = true
		displayName = getPreferredName(plugin.Package)
		incompatible = isIncompatiblePlugin(plugin, frontend)
	}
	return
}

func InstalledPlugins(frontend string, checkUpdate bool) (ret []*Plugin) {
	ret = []*Plugin{}

	pluginsPath := filepath.Join(util.DataDir, "plugins")
	if !util.IsPathRegularDirOrSymlinkDir(pluginsPath) {
		return
	}

	pluginDirs, err := os.ReadDir(pluginsPath)
	if nil != err {
		logging.LogWarnf("read plugins folder failed: %s", err)
		return
	}

	var bazaarPlugins []*Plugin
	if checkUpdate {
		bazaarPlugins = Plugins(frontend)
	}

	for _, pluginDir := range pluginDirs {
		if !util.IsDirRegularOrSymlink(pluginDir) {
			continue
		}
		dirName := pluginDir.Name()

		plugin, parseErr := PluginJSON(dirName)
		if nil != parseErr || nil == plugin {
			continue
		}

		installPath := filepath.Join(util.DataDir, "plugins", dirName)
		plugin.Installed = true
		plugin.RepoURL = plugin.URL
		plugin.PreviewURL = "/plugins/" + dirName + "/preview.png"
		plugin.PreviewURLThumb = "/plugins/" + dirName + "/preview.png"
		plugin.IconURL = "/plugins/" + dirName + "/icon.png"
		plugin.PreferredFunding = getPreferredFunding(plugin.Funding)
		plugin.PreferredName = getPreferredName(plugin.Package)
		plugin.PreferredDesc = getPreferredDesc(plugin.Description)
		info, statErr := os.Stat(filepath.Join(installPath, "README.md"))
		if nil != statErr {
			logging.LogWarnf("stat install theme README.md failed: %s", statErr)
			continue
		}
		plugin.HInstallDate = info.ModTime().Format("2006-01-02")
		installSize, _ := util.SizeOfDirectory(installPath)
		plugin.InstallSize = installSize
		plugin.HInstallSize = humanize.Bytes(uint64(installSize))
		readmeFilename := getPreferredReadme(plugin.Readme)
		readme, readErr := os.ReadFile(filepath.Join(installPath, readmeFilename))
		if nil != readErr {
			logging.LogWarnf("read installed README.md failed: %s", readErr)
			continue
		}

		plugin.PreferredReadme, _ = renderREADME(plugin.URL, readme)
		plugin.Outdated = isOutdatedPlugin(plugin, bazaarPlugins)
		plugin.Incompatible = isIncompatiblePlugin(plugin, frontend)
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

func isIncompatiblePlugin(plugin *Plugin, currentFrontend string) bool {
	if 1 > len(plugin.Backends) {
		return false
	}

	backendOk := false
	for _, backend := range plugin.Backends {
		if backend == getCurrentBackend() || "all" == backend {
			backendOk = true
			break
		}
	}

	frontendOk := false
	for _, frontend := range plugin.Frontends {
		if frontend == currentFrontend || "all" == frontend {
			frontendOk = true
			break
		}
	}
	return !backendOk || !frontendOk
}

func getCurrentBackend() string {
	switch util.Container {
	case util.ContainerDocker:
		return "docker"
	case util.ContainerIOS:
		return "ios"
	case util.ContainerAndroid:
		return "android"
	default:
		return runtime.GOOS
	}
}
