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
	"sync"
	"time"

	"github.com/88250/go-humanize"
	"github.com/88250/gulu"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/util"
	"golang.org/x/mod/semver"
	"golang.org/x/sync/singleflight"
)

type installSizeCacheEntry struct {
	size      int64
	expiresAt time.Time
}

var (
	installSizeCacheMu sync.RWMutex
	installSizeCache   = make(map[string]installSizeCacheEntry)
	installSizeVersion = make(map[string]uint64)
	installSizeFlight  singleflight.Group
)

// ReadInstalledPackageDirs 读取本地集市包的目录列表
func ReadInstalledPackageDirs(basePath string) ([]os.DirEntry, error) {
	if !util.IsPathRegularDirOrSymlinkDir(basePath) {
		return []os.DirEntry{}, nil
	}

	entries, err := os.ReadDir(basePath)
	if err != nil {
		return nil, err
	}

	dirs := make([]os.DirEntry, 0, len(entries))
	for _, e := range entries {
		if util.IsDirRegularOrSymlink(e) {
			dirs = append(dirs, e)
		}
	}
	return dirs, nil
}

// SetInstalledPackageMetadata 设置本地集市包的通用元数据
func SetInstalledPackageMetadata(pkg *Package, installPath, baseURLPath, pkgType string) bool {
	// 展示信息
	pkg.IconURL = baseURLPath + "icon.png"
	pkg.PreviewURL = baseURLPath + "preview.png"
	pkg.PreferredName = GetPreferredLocaleString(pkg.DisplayName, pkg.Name)
	pkg.PreferredDesc = GetPreferredLocaleString(pkg.Description, "")
	pkg.PreferredReadme = getInstalledPackageREADME(installPath, baseURLPath, pkg.Readme)
	pkg.PreferredFunding = getPreferredFunding(pkg.Funding)

	// 安装状态
	pkg.Installed = true
	pkg.DisallowInstall = isBelowRequiredAppVersion(pkg)
	pkg.RepoURL = pkg.URL

	// 安装信息
	pkg.InstallTime, pkg.UpdateTime = getPackageTimes(pkgType, pkg.Name, installPath)
	pkg.HInstallDate = time.UnixMilli(pkg.InstallTime).Format("2006-01-02")

	return true
}

// GetInstalledPackageSize 获取本地集市包的安装大小，结果缓存一分钟
func GetInstalledPackageSize(pkgType, packageName, installPath string) (size int64, hSize string, err error) {
	cacheKey := pkgType + ":" + packageName
	now := time.Now()
	installSizeCacheMu.RLock()
	cached, hit := installSizeCache[cacheKey]
	version := installSizeVersion[cacheKey]
	installSizeCacheMu.RUnlock()
	if hit && now.Before(cached.expiresAt) {
		size = cached.size
		hSize = humanize.BytesCustomCeil(uint64(size), 2)
		return
	}

	v, err, _ := installSizeFlight.Do(cacheKey, func() (any, error) {
		ret, sizeErr := util.SizeOfDirectory(installPath)
		if sizeErr != nil {
			return int64(0), sizeErr
		}
		installSizeCacheMu.Lock()
		if installSizeVersion[cacheKey] == version {
			installSizeCache[cacheKey] = installSizeCacheEntry{
				size:      ret,
				expiresAt: time.Now().Add(time.Minute),
			}
		}
		installSizeCacheMu.Unlock()
		return ret, nil
	})
	if err != nil {
		return
	}
	size = v.(int64)
	hSize = humanize.BytesCustomCeil(uint64(size), 2)
	return
}

// RemoveInstalledPackageSizeCache 删除本地集市包的安装大小缓存
func RemoveInstalledPackageSizeCache(pkgType, packageName string) {
	cacheKey := pkgType + ":" + packageName
	installSizeCacheMu.Lock()
	delete(installSizeCache, cacheKey)
	installSizeVersion[cacheKey]++
	installSizeCacheMu.Unlock()
	installSizeFlight.Forget(cacheKey)
}

// Add marketplace package config item `minAppVersion` https://github.com/siyuan-note/siyuan/issues/8330
func isBelowRequiredAppVersion(pkg *Package) bool {
	// 如果包没有指定 minAppVersion，则允许安装
	if "" == pkg.MinAppVersion {
		return false
	}

	// 如果包要求的 minAppVersion 大于当前版本，则不允许安装
	if 0 < semver.Compare("v"+pkg.MinAppVersion, "v"+util.Ver) {
		return true
	}
	return false
}

// IsBelowRequiredAppVersion 判断集市包要求的最低应用版本是否高于当前版本。
func IsBelowRequiredAppVersion(pkg *Package) bool {
	return isBelowRequiredAppVersion(pkg)
}

// BazaarInfo 集市的持久化信息
type BazaarInfo struct {
	Packages map[string]map[string]*PackageInfo `json:"packages"`
}

// PackageInfo 集市包的持久化信息
type PackageInfo struct {
	InstallTime int64 `json:"installTime"` // 安装时间戳（毫秒）
	UpdateTime  int64 `json:"updateTime"`  // 更新时间戳（毫秒）
}

var (
	bazaarInfoCache        *BazaarInfo
	bazaarInfoModTime      time.Time
	bazaarInfoCacheLock    = sync.RWMutex{}
	bazaarInfoSingleFlight singleflight.Group
)

// getBazaarInfo 确保集市持久化信息已加载到 bazaarInfoCache
func getBazaarInfo() {
	infoPath := filepath.Join(util.DataDir, "storage", "bazaar.json")
	info, err := os.Stat(infoPath)

	bazaarInfoCacheLock.RLock()
	cache := bazaarInfoCache
	modTime := bazaarInfoModTime
	bazaarInfoCacheLock.RUnlock()
	// 文件修改时间没变则认为缓存有效
	if cache != nil && err == nil && info.ModTime().Equal(modTime) {
		return
	}

	_, _, _ = bazaarInfoSingleFlight.Do("loadBazaarInfo", func() (any, error) {
		// 缓存失效时从磁盘加载
		newRet := loadBazaarInfo()
		// 更新缓存和修改时间
		bazaarInfoCacheLock.Lock()
		bazaarInfoCache = newRet
		if err == nil {
			bazaarInfoModTime = info.ModTime()
		}
		bazaarInfoCacheLock.Unlock()
		return newRet, nil
	})
}

// loadBazaarInfo 从磁盘加载集市持久化信息
func loadBazaarInfo() (ret *BazaarInfo) {
	// 初始化一个空的 BazaarInfo，后续使用时无需判断 nil
	ret = &BazaarInfo{
		Packages: make(map[string]map[string]*PackageInfo),
	}

	infoDir := filepath.Join(util.DataDir, "storage")
	if err := os.MkdirAll(infoDir, 0755); err != nil {
		logging.LogErrorf("create bazaar info dir [%s] failed: %s", infoDir, err)
		return
	}

	infoPath := filepath.Join(infoDir, "bazaar.json")
	if !filelock.IsExist(infoPath) {
		return
	}

	data, err := filelock.ReadFile(infoPath)
	if err != nil {
		logging.LogErrorf("read bazaar info [%s] failed: %s", infoPath, err)
		return
	}

	if err = gulu.JSON.UnmarshalJSON(data, &ret); err != nil {
		logging.LogErrorf("unmarshal bazaar info [%s] failed: %s", infoPath, err)
		ret = &BazaarInfo{
			Packages: make(map[string]map[string]*PackageInfo),
		}
	}

	return
}

// saveBazaarInfo 保存集市持久化信息（调用者需持有 bazaarInfoCacheLock 写锁）
func saveBazaarInfo() {
	infoPath := filepath.Join(util.DataDir, "storage", "bazaar.json")

	data, err := gulu.JSON.MarshalIndentJSON(bazaarInfoCache, "", "\t")
	if err != nil {
		logging.LogErrorf("marshal bazaar info [%s] failed: %s", infoPath, err)
		return
	}
	if err = filelock.WriteFile(infoPath, data); err != nil {
		logging.LogErrorf("write bazaar info [%s] failed: %s", infoPath, err)
		return
	}

	if fi, statErr := os.Stat(infoPath); statErr == nil {
		bazaarInfoModTime = fi.ModTime()
	}
}

// recordPackageOperationTime 记录集市包的首次安装时间或最近更新时间
func recordPackageOperationTime(pkgType, pkgName string, operationTime, fallbackInstallTime time.Time, update bool) {
	getBazaarInfo()

	bazaarInfoCacheLock.Lock()
	defer bazaarInfoCacheLock.Unlock()

	if bazaarInfoCache == nil {
		return
	}
	if bazaarInfoCache.Packages == nil {
		bazaarInfoCache.Packages = make(map[string]map[string]*PackageInfo)
	}
	if bazaarInfoCache.Packages[pkgType] == nil {
		bazaarInfoCache.Packages[pkgType] = make(map[string]*PackageInfo)
	}
	p := bazaarInfoCache.Packages[pkgType][pkgName]
	if p == nil {
		p = &PackageInfo{}
		bazaarInfoCache.Packages[pkgType][pkgName] = p
	}
	if update {
		if p.InstallTime < 1 {
			if fallbackInstallTime.IsZero() {
				fallbackInstallTime = operationTime
			}
			p.InstallTime = fallbackInstallTime.UnixMilli()
		}
		p.UpdateTime = operationTime.UnixMilli()
	} else {
		p.InstallTime = operationTime.UnixMilli()
		p.UpdateTime = 0
	}
	saveBazaarInfo()
}

// ensurePackageInstallTime 在没有首次安装时间时进行初始化
func ensurePackageInstallTime(pkgType, pkgName string, fallbackInstallTime time.Time) (installTime, updateTime int64) {
	getBazaarInfo()

	bazaarInfoCacheLock.Lock()
	defer bazaarInfoCacheLock.Unlock()

	if bazaarInfoCache == nil {
		return fallbackInstallTime.UnixMilli(), 0
	}
	if bazaarInfoCache.Packages == nil {
		bazaarInfoCache.Packages = make(map[string]map[string]*PackageInfo)
	}
	if bazaarInfoCache.Packages[pkgType] == nil {
		bazaarInfoCache.Packages[pkgType] = make(map[string]*PackageInfo)
	}
	p := bazaarInfoCache.Packages[pkgType][pkgName]
	if p == nil {
		p = &PackageInfo{}
		bazaarInfoCache.Packages[pkgType][pkgName] = p
	}
	if p.InstallTime < 1 {
		p.InstallTime = fallbackInstallTime.UnixMilli()
		saveBazaarInfo()
	}
	return p.InstallTime, p.UpdateTime
}

// getPackageTimes 获取集市包的首次安装时间和最近更新时间
func getPackageTimes(pkgType, pkgName, installPath string) (installTime, updateTime int64) {
	getBazaarInfo()
	bazaarInfoCacheLock.RLock()
	if bazaarInfoCache != nil && bazaarInfoCache.Packages[pkgType] != nil {
		if p := bazaarInfoCache.Packages[pkgType][pkgName]; p != nil {
			installTime = p.InstallTime
			updateTime = p.UpdateTime
		}
	}
	bazaarInfoCacheLock.RUnlock()

	if installTime > 0 {
		return
	}

	// 如果 bazaar.json 中没有记录，使用文件夹修改时间并记录到 bazaar.json 中
	fi, err := os.Stat(installPath)
	if err != nil {
		logging.LogWarnf("stat install package folder [%s] failed: %s", installPath, err)
		return ensurePackageInstallTime(pkgType, pkgName, time.Now())
	}
	return ensurePackageInstallTime(pkgType, pkgName, fi.ModTime())
}

// RemovePackageInfo 删除集市包的持久化信息
func RemovePackageInfo(pkgType, pkgName string) {
	getBazaarInfo()

	bazaarInfoCacheLock.Lock()
	defer bazaarInfoCacheLock.Unlock()

	if bazaarInfoCache != nil && bazaarInfoCache.Packages[pkgType] != nil {
		delete(bazaarInfoCache.Packages[pkgType], pkgName)
	}

	saveBazaarInfo()
}
