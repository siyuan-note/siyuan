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

package cache

import (
	"io/fs"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/util"
)

type AssetHash struct {
	Hash string `json:"hash"`
	Path string `json:"path"`
}

var (
	assetHashCache = map[string]*AssetHash{}
	assetHashLock  = sync.Mutex{}
)

func RemoveAssetHash(hash string) {
	assetHashLock.Lock()
	defer assetHashLock.Unlock()

	delete(assetHashCache, hash)
}

func SetAssetHash(hash, path string) {
	assetHashLock.Lock()
	defer assetHashLock.Unlock()

	assetHashCache[hash] = &AssetHash{
		Hash: hash,
		Path: path,
	}
}

func GetAssetHash(hash string) *AssetHash {
	assetHashLock.Lock()
	defer assetHashLock.Unlock()

	for _, a := range assetHashCache {
		if a.Hash == hash {
			if filelock.IsExist(filepath.Join(util.DataDir, a.Path)) {
				return a
			}

			delete(assetHashCache, hash)
			return nil
		}
	}
	return nil
}

type Asset struct {
	HName   string `json:"hName"`
	Path    string `json:"path"`
	Updated int64  `json:"updated"`
}

var (
	assetsCache = map[string]*Asset{}
	assetsLock  = sync.Mutex{}
)

func GetAssets() (ret map[string]*Asset) {
	assetsLock.Lock()
	defer assetsLock.Unlock()

	ret = map[string]*Asset{}
	for k, v := range assetsCache {
		ret[k] = v
	}
	return
}

func RemoveAsset(path string) {
	assetsLock.Lock()
	defer assetsLock.Unlock()

	delete(assetsCache, path)
}

func ExistAsset(path string) (ret bool) {
	assetsLock.Lock()
	defer assetsLock.Unlock()

	_, ret = assetsCache[path]
	return
}

func LoadAssets() {
	defer logging.Recover()

	start := time.Now()
	assetsLock.Lock()
	defer assetsLock.Unlock()

	assetsCache = map[string]*Asset{}
	assets := util.GetDataAssetsAbsPath()
	filelock.Walk(assets, func(path string, d fs.DirEntry, err error) error {
		if nil != err || nil == d {
			return err
		}
		if d.IsDir() {
			if strings.HasPrefix(d.Name(), ".") {
				return filepath.SkipDir
			}
			return nil
		}
		if strings.HasSuffix(d.Name(), ".sya") || strings.HasPrefix(d.Name(), ".") || filelock.IsHidden(path) {
			return nil
		}

		info, err := d.Info()
		if nil != err {
			logging.LogErrorf("load assets failed: %s", err)
			return nil
		}

		hName := util.RemoveID(d.Name())
		path = "assets" + filepath.ToSlash(strings.TrimPrefix(path, assets))
		assetsCache[path] = &Asset{
			HName:   hName,
			Path:    path,
			Updated: info.ModTime().Unix(),
		}
		return nil
	})
	elapsed := time.Since(start)
	if 2000 < elapsed.Milliseconds() {
		logging.LogInfof("loaded assets [%.2fs]", elapsed.Seconds())
	}
}
