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

	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/util"
)

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

		plugin, parseErr := ParsePackageJSON(filepath.Join(util.DataDir, "plugins", dirName, "plugin.json"))
		if nil != parseErr || nil == plugin {
			return
		}

		found = true
		displayName = GetPreferredLocaleString(plugin.DisplayName, plugin.Name)
		incompatible = IsIncompatiblePlugin(plugin, frontend)
		disabledInPublish = plugin.DisabledInPublish
		disallowInstall = isBelowRequiredAppVersion(plugin)
	}
	return
}

// IsIncompatiblePlugin 判断插件是否与当前环境不兼容
func IsIncompatiblePlugin(plugin *Package, frontend string) bool {
	backend := getCurrentBackend()
	if !isTargetSupported(plugin.Backends, backend) {
		return true
	}

	if !isTargetSupported(plugin.Frontends, frontend) {
		return true
	}

	return false
}

// isTargetSupported 检查 platforms 中是否包含 target 或 "all"
func isTargetSupported(platforms []string, target string) bool {
	// 缺失字段时跳过检查，相当于 all
	if len(platforms) == 0 {
		return true
	}
	for _, v := range platforms {
		if v == target || v == "all" {
			return true
		}
	}
	return false
}

var cachedBackend string

func getCurrentBackend() string {
	if cachedBackend == "" {
		if util.Container == util.ContainerStd {
			cachedBackend = runtime.GOOS
		} else {
			cachedBackend = util.Container
		}
	}
	return cachedBackend
}
