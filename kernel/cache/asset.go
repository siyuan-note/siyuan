// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

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
	assetHashCache     = map[string]*AssetHash{}
	assetPathHashCache = map[string]*AssetHash{}
	assetHashLock      = sync.Mutex{}
)

func RemoveAssetHash(hash string) {
	assetHashLock.Lock()
	defer assetHashLock.Unlock()

	asset := assetHashCache[hash]
	if nil != asset {
		delete(assetHashCache, hash)
		delete(assetPathHashCache, asset.Path)
	}
}

// RemoveAssetHashByPath 按资源路径清理缓存，不读取可能已删除的文件。
func RemoveAssetHashByPath(path string) {
	assetHashLock.Lock()
	defer assetHashLock.Unlock()

	removeAssetHashByPath(path)
}

func removeAssetHashByPath(path string) {
	asset := assetPathHashCache[path]
	if asset == nil {
		return
	}
	delete(assetPathHashCache, path)
	// 相同内容可能对应多个路径，保留指向其他资源的去重记录。
	if cached := assetHashCache[asset.Hash]; cached != nil && cached.Path == path {
		delete(assetHashCache, asset.Hash)
	}
}

func SetAssetHash(hash, path string) {
	assetHashLock.Lock()
	defer assetHashLock.Unlock()

	if !strings.HasPrefix(path, "assets/") {
		logging.LogErrorf("invalid asset path [%s]", path)
		return
	}

	removeAssetHashByPath(path)
	assetHashCache[hash] = &AssetHash{Hash: hash, Path: path}
	assetPathHashCache[path] = &AssetHash{Hash: hash, Path: path}
}

func GetAssetHashByPath(path string) *AssetHash {
	assetHashLock.Lock()
	defer assetHashLock.Unlock()

	asset, exists := assetPathHashCache[path]
	if exists {
		if filelock.IsExist(filepath.Join(util.DataDir, asset.Path)) {
			return asset
		}

		removeAssetHashByPath(path)
		return nil
	}
	return nil
}

func GetAssetHash(hash string) *AssetHash {
	assetHashLock.Lock()
	defer assetHashLock.Unlock()

	// 直接使用 hash 作为 key 进行查找
	asset, exists := assetHashCache[hash]
	if !exists {
		return nil
	}

	if !filelock.IsExist(filepath.Join(util.DataDir, asset.Path)) {
		// 文件不存在，清理缓存
		delete(assetHashCache, hash)
		delete(assetPathHashCache, asset.Path)
		return nil
	}
	return asset
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

// FilterAssets 根据过滤函数返回符合条件的资源
func FilterAssets(filter func(path string, asset *Asset) bool) (ret map[string]*Asset) {
	assetsLock.Lock()
	defer assetsLock.Unlock()

	ret = map[string]*Asset{}
	for path, asset := range assetsCache {
		if filter(path, asset) {
			ret[path] = asset
		}
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
		if strings.HasSuffix(d.Name(), ".sya") || strings.HasPrefix(d.Name(), ".") || filelock.IsHidden(path) || util.IsOfficeTempFile(path) {
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
