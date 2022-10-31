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
	"os"
	"path/filepath"
	"sync"

	"github.com/88250/gulu"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var localStorageLock = sync.Mutex{}

func RemoveLocalStorageVal(key string) (err error) {
	localStorageLock.Lock()
	defer localStorageLock.Unlock()

	localStorage, err := getLocalStorage()
	if nil != err {
		return
	}

	delete(localStorage, key)
	return setLocalStorage(localStorage)
}

func SetLocalStorageVal(key string, val interface{}) (err error) {
	localStorageLock.Lock()
	defer localStorageLock.Unlock()

	localStorage, err := getLocalStorage()
	if nil != err {
		return
	}

	localStorage[key] = val
	return setLocalStorage(localStorage)
}

func SetLocalStorage(val interface{}) (err error) {
	localStorageLock.Lock()
	defer localStorageLock.Unlock()
	return setLocalStorage(val)
}

func GetLocalStorage() (ret map[string]interface{}, err error) {
	localStorageLock.Lock()
	defer localStorageLock.Unlock()
	return getLocalStorage()
}

func setLocalStorage(val interface{}) (err error) {
	dirPath := filepath.Join(util.DataDir, "storage")
	if err = os.MkdirAll(dirPath, 0755); nil != err {
		logging.LogErrorf("create local storage dir failed: %s", err)
		return
	}

	data, err := gulu.JSON.MarshalJSON(val)
	if nil != err {
		logging.LogErrorf("marshal local storage failed: %s", err)
		return
	}

	lsPath := filepath.Join(dirPath, "local.json")
	err = filelock.WriteFile(lsPath, data)
	if nil != err {
		logging.LogErrorf("write local storage failed: %s", err)
		return
	}
	return
}

func getLocalStorage() (ret map[string]interface{}, err error) {
	lsPath := filepath.Join(util.DataDir, "storage/local.json")
	if !gulu.File.IsExist(lsPath) {
		return
	}

	data, err := filelock.ReadFile(lsPath)
	if nil != err {
		logging.LogErrorf("read local storage failed: %s", err)
		return
	}

	ret = map[string]interface{}{}
	if err = gulu.JSON.UnmarshalJSON(data, &ret); nil != err {
		logging.LogErrorf("unmarshal local storage failed: %s", err)
		return
	}
	return
}
