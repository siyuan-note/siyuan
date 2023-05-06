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

package model

import (
	"crypto/sha1"
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
	ID      string `json:"id"`      // Plugin ID
	Name    string `json:"name"`    // Plugin name
	Enabled bool   `json:"enabled"` // Whether enabled

	JS   string                 `json:"js"`   // JS code
	CSS  string                 `json:"css"`  // CSS code
	I18n map[string]interface{} `json:"i18n"` // i18n text
}

func SetPetalEnabled(name string, enabled bool) {
	petals := getPetals()

	plugins := bazaar.InstalledPlugins()
	var plugin *bazaar.Plugin
	for _, p := range plugins {
		if p.Name == name {
			plugin = p
			break
		}
	}
	if nil == plugin {
		logging.LogErrorf("plugin [%s] not found", name)
		return
	}

	petal := getPetalByName(plugin.Name, petals)
	if nil == petal {
		petal = &Petal{
			ID:      hash(plugin.Name),
			Name:    plugin.Name,
			Enabled: enabled,
		}
		petals = append(petals, petal)
	} else {
		petal.Enabled = enabled
	}

	savePetals(petals)
}

func LoadPetals() (ret []*Petal) {
	ret = getPetals()

	plugins := bazaar.InstalledPlugins()
	for _, plugin := range plugins {
		petal := getPetalByName(plugin.Name, ret)
		if nil == petal {
			continue
		}

		pluginDir := filepath.Join(util.DataDir, "plugins", plugin.Name)
		data, err := filelock.ReadFile(filepath.Join(pluginDir, "index.js"))
		if nil != err {
			logging.LogErrorf("read plugin [%s] js failed: %s", plugin.Name, err)
			continue
		}
		petal.JS = string(data)

		cssPath := filepath.Join(pluginDir, "index.css")
		if gulu.File.IsExist(cssPath) {
			data, err := filelock.ReadFile(cssPath)
			if nil != err {
				logging.LogErrorf("read plugin [%s] css failed: %s", plugin.Name, err)
			} else {
				petal.CSS = string(data)
			}
		}

		i18nPath := filepath.Join(pluginDir, "i18n", Conf.Lang)
		if gulu.File.IsExist(i18nPath) {
			data, err := filelock.ReadFile(i18nPath)
			if nil != err {
				logging.LogErrorf("read plugin [%s] i18n failed: %s", plugin.Name, err)
			} else {
				petal.I18n = map[string]interface{}{}
				if err = gulu.JSON.UnmarshalJSON(data, &petal.I18n); nil != err {
					logging.LogErrorf("unmarshal plugin [%s] i18n failed: %s", plugin.Name, err)
				}
			}
		}

		ret = append(ret, petal)
	}
	return
}

var petalsStoreLock = sync.Mutex{}

func savePetals(petals []*Petal) {
	petalsStoreLock.Lock()
	defer petalsStoreLock.Unlock()

	petalDir := filepath.Join(util.DataDir, "storage", "petal")
	confPath := filepath.Join(petalDir, "petals.json")
	data, err := gulu.JSON.MarshalIndentJSON(petals, "", "\t")
	if nil != err {
		logging.LogErrorf("marshal petals failed: %s", err)
		return
	}
	if err = filelock.WriteFile(confPath, data); nil != err {
		logging.LogErrorf("write petals [%s] failed: %s", confPath, err)
		return
	}
}

func getPetals() (ret []*Petal) {
	petalsStoreLock.Lock()
	defer petalsStoreLock.Unlock()

	ret = []*Petal{}
	petalDir := filepath.Join(util.DataDir, "storage", "petal")
	if err := os.MkdirAll(petalDir, 0755); nil != err {
		logging.LogErrorf("create petal dir [%s] failed: %s", petalDir, err)
		return
	}

	confPath := filepath.Join(petalDir, "petals.json")
	if !gulu.File.IsExist(confPath) {
		data, err := gulu.JSON.MarshalIndentJSON(ret, "", "\t")
		if nil != err {
			logging.LogErrorf("marshal petals failed: %s", err)
			return
		}
		if err = filelock.WriteFile(confPath, data); nil != err {
			logging.LogErrorf("write petals [%s] failed: %s", confPath, err)
			return
		}
		return
	}

	data, err := filelock.ReadFile(confPath)
	if nil != err {
		logging.LogErrorf("read petal file [%s] failed: %s", confPath, err)
		return
	}

	if err = gulu.JSON.UnmarshalJSON(data, &ret); nil != err {
		logging.LogErrorf("unmarshal petals failed: %s", err)
		return
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

func hash(str string) string {
	return fmt.Sprintf("%x", sha1.Sum([]byte(str)))
}
