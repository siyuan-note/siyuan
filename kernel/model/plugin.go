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

package model

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"

	"github.com/88250/gulu"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/bazaar"
	"github.com/siyuan-note/siyuan/kernel/util"
	"golang.org/x/sync/singleflight"
)

// Petal represents a plugin's management status.
type Petal struct {
	Name              string `json:"name"`              // Plugin name
	DisplayName       string `json:"displayName"`       // Plugin display name
	Enabled           bool   `json:"enabled"`           // Whether enabled
	Incompatible      bool   `json:"incompatible"`      // Whether incompatible
	DisabledInPublish bool   `json:"disabledInPublish"` // Whether disabled in publish mode
	DisallowInstall   bool   `json:"disallowInstall"`   // Whether disallow install

	JS     string         `json:"js"`     // JS code
	CSS    string         `json:"css"`    // CSS code
	I18n   map[string]any `json:"i18n"`   // i18n text
	Kernel KernelPetal    `json:"kernel"` // Kernel plugin info
}

type KernelPetal struct {
	JS           string `json:"js"`           // Kernel JS code
	Existed      bool   `json:"existed"`      // Whether kernel.js is exist
	Incompatible bool   `json:"incompatible"` // Whether incompatible
}

var (
	OnKernelPluginStart    func(petal *Petal) // Called when a plugin is enabled (after loading and starting the plugin)
	OnKernelPluginStop     func(petal *Petal) // Called when a plugin is disabled (before stopping and unloading the plugin)
	OnKernelPluginShutdown func()             // Called when SiYuan is shutting down, before stopping all plugins
)

func SetPetalEnabled(name string, enabled bool) (ret *Petal, err error) {
	petals := getPetals()

	found, displayName, incompatible, disabledInPublish, disallowInstall, kernelIncompatible := bazaar.ParseInstalledPlugin(name, "")
	if !found {
		logging.LogErrorf("plugin [%s] not found", name)
		return
	}

	ret = getPetalByName(name, petals)
	if nil == ret {
		ret = &Petal{
			Name: name,
		}
		petals = append(petals, ret)
	}
	ret.DisplayName = displayName
	ret.Enabled = enabled
	ret.Incompatible = incompatible
	ret.DisabledInPublish = disabledInPublish
	ret.DisallowInstall = disallowInstall
	ret.Kernel = KernelPetal{
		Incompatible: kernelIncompatible,
	}

	if enabled && disallowInstall {
		err = fmt.Errorf("require upgrade SiYuan to use this plugin [%s]", name)
		logging.LogInfof("require upgrade SiYuan to use this plugin [%s]", name)
		return
	}

	savePetals(petals)

	loadCode(ret)

	// Hook kernel plugin lifecycle (callbacks avoid circular import with plugin package)
	if enabled {
		if OnKernelPluginStart != nil {
			OnKernelPluginStart(ret)
		}
	} else {
		if OnKernelPluginStop != nil {
			OnKernelPluginStop(ret)
		}
	}
	return
}

func getPetalByName(name string, petals []*Petal) (ret *Petal) {
	for _, p := range petals {
		if name == p.Name {
			ret = p
			break
		}
	}
	return
}

var loadPetalsFlight singleflight.Group

// IsPetalsEnabled returns whether petals are enabled and trusted to be loaded
func IsPetalsEnabled() bool {
	if Conf.Bazaar.PetalDisabled {
		return false
	}

	if !Conf.Bazaar.Trust {
		// 移动端没有集市模块，所以要默认开启，桌面端和 Docker 容器需要用户手动确认过信任后才能开启
		if util.Container == util.ContainerStd || util.Container == util.ContainerDocker {
			return false
		}
	}
	return true
}

func LoadPetals(frontend string, isPublish bool) (ret []*Petal) {
	// 调用 setPetalEnabled 接口之后推送消息到所有前端实例，接着会同时调用 loadPetals 接口，合并相同类型的请求为一次执行
	key := "loadPetals:" + frontend + ":" + strconv.FormatBool(isPublish)
	v, err, _ := loadPetalsFlight.Do(key, func() (any, error) {
		return loadPetals(frontend, isPublish, false), nil
	})
	if err != nil {
		return []*Petal{}
	}
	return v.([]*Petal)
}

func LoadKernelPetals() (ret []*Petal) {
	v, err, _ := loadPetalsFlight.Do("loadKernelPetals", func() (any, error) {
		return loadPetals("", false, true), nil
	})
	if err != nil {
		return []*Petal{}
	}
	return v.([]*Petal)
}

func loadPetals(frontend string, isPublish, isKernel bool) (ret []*Petal) {
	ret = []*Petal{}

	if !IsPetalsEnabled() {
		return
	}

	var petalNames []string
	petals := getPetals()
	for _, petal := range petals {
		_, petal.DisplayName, petal.Incompatible, petal.DisabledInPublish, petal.DisallowInstall, petal.Kernel.Incompatible = bazaar.ParseInstalledPlugin(petal.Name, frontend)
		if !petal.Enabled {
			// disabled plugin
			continue
		}

		if isKernel {
			// kernel plugin
			if petal.Kernel.Incompatible {
				// incompatible kernel plugin
				continue
			}
		} else {
			// client plugin
			if petal.Incompatible {
				// incompatible client plugin
				continue
			}

			if isPublish && petal.DisabledInPublish {
				// disabled plugin in publish mode
				continue
			}
		}

		if petal.DisallowInstall {
			// disallow install plugin (require upgrade SiYuan), auto disable it to avoid potential issues, and skip loading
			SetPetalEnabled(petal.Name, false)
			logging.LogInfof("plugin [%s] disallowed install, auto disabled", petal.Name)
			continue
		}

		loadCode(petal)
		if isKernel {
			if !petal.Kernel.Existed {
				logging.LogWarnf("plugin [%s] kernel.js not found, skip loading as kernel plugin", petal.Name)
				continue
			}
		}

		ret = append(ret, petal)
		petalNames = append(petalNames, petal.Name)
	}

	logging.LogDebugf("loaded petals [frontend=%s, isPublish=%v, isKernel=%v, petals=[%s]]", frontend, isPublish, isKernel, strings.Join(petalNames, ","))
	return
}

func loadCode(petal *Petal) {
	pluginDir := filepath.Join(util.DataDir, "plugins", petal.Name)
	jsPath := filepath.Join(pluginDir, "index.js")
	if !filelock.IsExist(jsPath) {
		logging.LogErrorf("plugin [%s] index.js not found", petal.Name)
		return
	}

	data, err := filelock.ReadFile(jsPath)
	if err != nil {
		logging.LogErrorf("read plugin [%s] index.js failed: %s", petal.Name, err)
		return
	}
	petal.JS = string(data)

	kernelJsPath := filepath.Join(pluginDir, "kernel.js")
	if filelock.IsExist(kernelJsPath) {
		data, err = filelock.ReadFile(kernelJsPath)
		if err != nil {
			logging.LogErrorf("read plugin [%s] kernel.js failed: %s", petal.Name, err)
		} else {
			petal.Kernel.JS = string(data)
			petal.Kernel.Existed = true
		}
	}

	cssPath := filepath.Join(pluginDir, "index.css")
	if filelock.IsExist(cssPath) {
		data, err = filelock.ReadFile(cssPath)
		if err != nil {
			logging.LogErrorf("read plugin [%s] index.css failed: %s", petal.Name, err)
		} else {
			petal.CSS = string(data)
		}
	}

	i18nDir := filepath.Join(pluginDir, "i18n")
	if gulu.File.IsDir(i18nDir) {
		langJSONs, readErr := os.ReadDir(i18nDir)
		if nil != readErr {
			logging.LogErrorf("read plugin [%s] i18n failed: %s", petal.Name, readErr)
		} else if 0 < len(langJSONs) {
			preferredLang := Conf.Lang + ".json"
			foundPreferredLang := false
			foundEnUS := false
			foundZhCN := false
			for _, langJSON := range langJSONs {
				if langJSON.Name() == preferredLang {
					foundPreferredLang = true
					break
				}
				if langJSON.Name() == "en_US.json" {
					foundEnUS = true
				}
				if langJSON.Name() == "zh_CN.json" {
					foundZhCN = true
				}
			}

			if !foundPreferredLang {
				if foundEnUS {
					preferredLang = "en_US.json"
				} else if foundZhCN {
					preferredLang = "zh_CN.json"
				} else {
					preferredLang = langJSONs[0].Name()
				}
			}

			if langFilePath := filepath.Join(i18nDir, preferredLang); gulu.File.IsExist(langFilePath) {
				data, err = filelock.ReadFile(langFilePath)
				if err != nil {
					logging.LogErrorf("read plugin [%s] i18n failed: %s", petal.Name, err)
				} else {
					petal.I18n = map[string]any{}
					if err = gulu.JSON.UnmarshalJSON(data, &petal.I18n); err != nil {
						logging.LogErrorf("unmarshal plugin [%s] i18n failed: %s", petal.Name, err)
					}
				}
			}
		}
	}
}

var petalsStoreLock = sync.Mutex{}

func savePetals(petals []*Petal) {
	petalsStoreLock.Lock()
	defer petalsStoreLock.Unlock()
	savePetals0(petals)
}

func savePetals0(petals []*Petal) {
	if 1 > len(petals) {
		petals = []*Petal{}
	}

	petalDir := filepath.Join(util.DataDir, "storage", "petal")
	confPath := filepath.Join(petalDir, "petals.json")
	data, err := gulu.JSON.MarshalIndentJSON(petals, "", "\t")
	if err != nil {
		logging.LogErrorf("marshal petals failed: %s", err)
		return
	}
	if err = filelock.WriteFile(confPath, data); err != nil {
		logging.LogErrorf("write petals [%s] failed: %s", confPath, err)
		return
	}
}

func getPetals() (ret []*Petal) {
	petalsStoreLock.Lock()
	defer petalsStoreLock.Unlock()

	ret = []*Petal{}
	petalDir := filepath.Join(util.DataDir, "storage", "petal")
	if err := os.MkdirAll(petalDir, 0755); err != nil {
		logging.LogErrorf("create petal dir [%s] failed: %s", petalDir, err)
		return
	}

	confPath := filepath.Join(petalDir, "petals.json")
	if !filelock.IsExist(confPath) {
		data, err := gulu.JSON.MarshalIndentJSON(ret, "", "\t")
		if err != nil {
			logging.LogErrorf("marshal petals failed: %s", err)
			return
		}
		if err = filelock.WriteFile(confPath, data); err != nil {
			logging.LogErrorf("write petals [%s] failed: %s", confPath, err)
			return
		}
		return
	}

	data, err := filelock.ReadFile(confPath)
	if err != nil {
		logging.LogErrorf("read petal file [%s] failed: %s", confPath, err)
		return
	}

	if err = gulu.JSON.UnmarshalJSON(data, &ret); err != nil {
		logging.LogErrorf("unmarshal petals failed: %s", err)
		return
	}

	var tmp []*Petal
	pluginsDir := filepath.Join(util.DataDir, "plugins")
	for _, petal := range ret {
		pluginJSONPath := filepath.Join(pluginsDir, petal.Name, "plugin.json")
		if filelock.IsExist(pluginJSONPath) {
			tmp = append(tmp, petal)
		} else {
			// 插件不存在时，删除对应的持久化信息
			bazaar.RemovePackageInfo("plugins", petal.Name)
		}
	}
	if len(tmp) != len(ret) {
		savePetals0(tmp)
		ret = tmp
	}
	if 1 > len(ret) {
		ret = []*Petal{}
	}
	return
}
