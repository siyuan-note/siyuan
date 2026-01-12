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
	"sync"

	"github.com/88250/gulu"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/bazaar"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// Petal represents a plugin's management status.
type Petal struct {
	Name              string `json:"name"`              // Plugin name
	DisplayName       string `json:"displayName"`       // Plugin display name
	Enabled           bool   `json:"enabled"`           // Whether enabled
	Incompatible      bool   `json:"incompatible"`      // Whether incompatible
	DisabledInPublish bool   `json:"disabledInPublish"` // Whether disabled in publish mode
	DisallowInstall   bool   `json:"disallowInstall"`   // Whether disallow install

	JS   string                 `json:"js"`   // JS code
	CSS  string                 `json:"css"`  // CSS code
	I18n map[string]interface{} `json:"i18n"` // i18n text
}

func SetPetalEnabled(name string, enabled bool, frontend string) (ret *Petal, err error) {
	petals := getPetals()

	found, displayName, incompatible, disabledInPublish, disallowInstall := bazaar.ParseInstalledPlugin(name, frontend)
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

	if enabled && incompatible {
		err = fmt.Errorf(Conf.Language(205))
		logging.LogInfof("plugin [%s] is incompatible [%s]", name, frontend)
		return
	}

	if enabled && disallowInstall {
		msg := "require upgrade SiYuan to use this plugin [" + name + "]"
		err = fmt.Errorf(msg)
		logging.LogInfof(msg)
		return
	}

	savePetals(petals)
	loadCode(ret)
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

func LoadPetals(frontend string, isPublish bool) (ret []*Petal) {
	ret = []*Petal{}

	if Conf.Bazaar.PetalDisabled {
		return
	}

	if !Conf.Bazaar.Trust {
		// 移动端没有集市模块，所以要默认开启，桌面端和 Docker 容器需要用户手动确认过信任后才能开启
		if util.ContainerStd == util.Container || util.ContainerDocker == util.Container {
			return
		}
	}

	petals := getPetals()
	for _, petal := range petals {
		_, petal.DisplayName, petal.Incompatible, petal.DisabledInPublish, petal.DisallowInstall = bazaar.ParseInstalledPlugin(petal.Name, frontend)
		if !petal.Enabled || petal.Incompatible || (isPublish && petal.DisabledInPublish) || petal.DisallowInstall {
			if petal.DisallowInstall {
				SetPetalEnabled(petal.Name, false, frontend)
				logging.LogInfof("plugin [%s] disallowed install, auto disabled", petal.Name)
			}
			continue
		}

		loadCode(petal)
		ret = append(ret, petal)
	}
	return
}

func loadCode(petal *Petal) {
	pluginDir := filepath.Join(util.DataDir, "plugins", petal.Name)
	jsPath := filepath.Join(pluginDir, "index.js")
	if !filelock.IsExist(jsPath) {
		logging.LogErrorf("plugin [%s] js not found", petal.Name)
		return
	}

	data, err := filelock.ReadFile(jsPath)
	if err != nil {
		logging.LogErrorf("read plugin [%s] js failed: %s", petal.Name, err)
		return
	}
	petal.JS = string(data)

	cssPath := filepath.Join(pluginDir, "index.css")
	if filelock.IsExist(cssPath) {
		data, err = filelock.ReadFile(cssPath)
		if err != nil {
			logging.LogErrorf("read plugin [%s] css failed: %s", petal.Name, err)
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
					petal.I18n = map[string]interface{}{}
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
		pluginPath := filepath.Join(pluginsDir, petal.Name)
		if hasPluginFiles(pluginPath) {
			tmp = append(tmp, petal)
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

// hasPluginFiles 检查插件安装目录是否存在且包含文件
func hasPluginFiles(pluginPath string) bool {
	if !filelock.IsExist(pluginPath) {
		return false
	}
	entries, err := os.ReadDir(pluginPath)
	if err != nil {
		return false
	}
	for _, entry := range entries {
		if !entry.IsDir() {
			return true
		}
	}
	return false
}
