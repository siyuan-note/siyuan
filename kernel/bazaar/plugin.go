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
	"runtime"
	"sort"
	"strings"

	"github.com/88250/go-humanize"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/util"
)

type Plugin struct {
	*Package
	Enabled bool `json:"enabled"`
}

// Plugins 返回集市插件列表
func Plugins(frontend string) (plugins []*Plugin) {
	plugins = []*Plugin{}
	result := getStageAndBazaar("plugins")

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
		plugin := buildPluginFromStageRepo(repo, frontend, result.BazaarIndex)
		if nil != plugin {
			plugins = append(plugins, plugin)
		}
	}

	sort.Slice(plugins, func(i, j int) bool { return plugins[i].Updated > plugins[j].Updated })
	return
}

// buildPluginFromStageRepo 使用 stage 内嵌的 package 构建 *Plugin，不发起 HTTP 请求。
func buildPluginFromStageRepo(repo *StageRepo, frontend string, bazaarIndex map[string]*bazaarPackage) *Plugin {
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
	pkg.Incompatible = isIncompatiblePlugin(&Plugin{Package: &pkg}, frontend)
	if bp := bazaarIndex[repoURLHash[0]]; nil != bp {
		pkg.Downloads = bp.Downloads
	}
	packageInstallSizeCache.SetDefault(pkg.RepoURL, pkg.InstallSize)
	return &Plugin{Package: &pkg}
}

func ParseInstalledPlugin(name, frontend string) (found bool, displayName string, incompatible, disabledInPublish, disallowInstall bool) {
	pluginsPath := filepath.Join(util.DataDir, "plugins")
	if !util.IsPathRegularDirOrSymlinkDir(pluginsPath) {
		return
	}

	pluginDirs, err := os.ReadDir(pluginsPath)
	if err != nil {
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
		displayName = GetPreferredName(plugin.Package)
		incompatible = isIncompatiblePlugin(plugin, frontend)
		disabledInPublish = plugin.DisabledInPublish
		disallowInstall = disallowInstallBazaarPackage(plugin.Package)
	}
	return
}

func InstalledPlugins(frontend string) (ret []*Plugin) {
	ret = []*Plugin{}

	pluginsPath := filepath.Join(util.DataDir, "plugins")
	if !util.IsPathRegularDirOrSymlinkDir(pluginsPath) {
		return
	}

	pluginDirs, err := os.ReadDir(pluginsPath)
	if err != nil {
		logging.LogWarnf("read plugins folder failed: %s", err)
		return
	}

	bazaarPlugins := Plugins(frontend)

	for _, pluginDir := range pluginDirs {
		if !util.IsDirRegularOrSymlink(pluginDir) {
			continue
		}
		dirName := pluginDir.Name()

		plugin, parseErr := PluginJSON(dirName)
		if nil != parseErr || nil == plugin {
			continue
		}

		plugin.RepoURL = plugin.URL
		plugin.DisallowInstall = disallowInstallBazaarPackage(plugin.Package)
		if bazaarPkg := getBazaarPlugin(plugin.Name, bazaarPlugins); nil != bazaarPkg {
			plugin.DisallowUpdate = disallowInstallBazaarPackage(bazaarPkg.Package)
			plugin.UpdateRequiredMinAppVer = bazaarPkg.MinAppVersion
			plugin.RepoURL = bazaarPkg.RepoURL
		}

		installPath := filepath.Join(util.DataDir, "plugins", dirName)
		plugin.Installed = true
		plugin.PreviewURL = "/plugins/" + dirName + "/preview.png"
		plugin.PreviewURLThumb = "/plugins/" + dirName + "/preview.png"
		plugin.IconURL = "/plugins/" + dirName + "/icon.png"
		plugin.PreferredFunding = getPreferredFunding(plugin.Funding)
		plugin.PreferredName = GetPreferredName(plugin.Package)
		plugin.PreferredDesc = getPreferredDesc(plugin.Description)
		info, statErr := os.Stat(filepath.Join(installPath, "plugin.json"))
		if nil != statErr {
			logging.LogWarnf("stat install plugin.json failed: %s", statErr)
			continue
		}
		plugin.HInstallDate = info.ModTime().Format("2006-01-02")
		if installSize, ok := packageInstallSizeCache.Get(plugin.RepoURL); ok {
			plugin.InstallSize = installSize.(int64)
		} else {
			is, _ := util.SizeOfDirectory(installPath)
			plugin.InstallSize = is
			packageInstallSizeCache.SetDefault(plugin.RepoURL, is)
		}
		plugin.HInstallSize = humanize.BytesCustomCeil(uint64(plugin.InstallSize), 2)
		plugin.PreferredReadme = loadInstalledReadme(installPath, "/plugins/"+dirName+"/", plugin.Readme)
		plugin.Outdated = isOutdatedPlugin(plugin, bazaarPlugins)
		plugin.Incompatible = isIncompatiblePlugin(plugin, frontend)
		ret = append(ret, plugin)
	}
	return
}

func getBazaarPlugin(name string, plugins []*Plugin) *Plugin {
	for _, p := range plugins {
		if p.Name == name {
			return p
		}
	}
	return nil
}

func InstallPlugin(repoURL, repoHash, installPath string, systemID string) error {
	repoURLHash := repoURL + "@" + repoHash
	data, err := downloadPackage(repoURLHash, true, systemID)
	if err != nil {
		return err
	}
	return installPackage(data, installPath, repoURLHash)
}

func UninstallPlugin(installPath string) error {
	return uninstallPackage(installPath)
}

func isIncompatiblePlugin(plugin *Plugin, currentFrontend string) bool {
	if 1 > len(plugin.Backends) {
		return false
	}

	currentBackend := getCurrentBackend()
	backendOk := false
	for _, backend := range plugin.Backends {
		if backend == currentBackend || "all" == backend {
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
	case util.ContainerHarmony:
		return "harmony"
	default:
		return runtime.GOOS
	}
}
