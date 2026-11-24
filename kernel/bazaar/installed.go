// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package bazaar

import (
	"io"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
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

// PackageDirContainsFile 判断集市包目录中是否递归包含实际文件。
// 忽略 macOS 自动生成的 .DS_Store，它不代表包内存在有效文件。
func PackageDirContainsFile(dirPath string) (bool, error) {
	entries, err := os.ReadDir(dirPath)
	if err != nil {
		return false, err
	}
	for _, entry := range entries {
		if entry.Type().IsRegular() && util.IsSystemMetadataFile(entry.Name()) {
			continue
		}
		if !entry.IsDir() {
			return true, nil
		}
		containsFile, readErr := PackageDirContainsFile(filepath.Join(dirPath, entry.Name()))
		if readErr != nil {
			return false, readErr
		}
		if containsFile {
			return true, nil
		}
	}
	return false, nil
}

// installedManifestStamp 用清单文件的大小与修改时间判断解析结果是否仍然有效。
type installedManifestStamp struct {
	size    int64
	modTime int64
}

// installedManifestCacheEntry 保存已安装包清单的解析结果及其校验信息。
type installedManifestCacheEntry struct {
	stamp installedManifestStamp
	pkg   *Package
}

var (
	installedManifestCacheMu sync.RWMutex
	installedManifestCache   = map[string]map[string]installedManifestCacheEntry{} // 包类型 -> 安装目录 -> 清单解析结果
	installedManifestReader  = readInstalledPackageManifest                        // 读取入口，便于测试替换
)

// readInstalledPackageManifest 打开一次清单文件，同时取得修改时间、大小并解析内容，
// 避免先 stat 再读取时的第二次打开。
func readInstalledPackageManifest(manifestPath string) (stamp installedManifestStamp, pkg *Package, err error) {
	file, err := filelock.OpenFile(manifestPath, os.O_RDONLY, 0)
	if err != nil {
		return
	}
	defer filelock.CloseFile(file)

	info, err := file.Stat()
	if err != nil {
		return
	}
	data, err := io.ReadAll(file)
	if err != nil {
		logging.LogErrorf("read [%s] failed: %s", manifestPath, err)
		return
	}
	if pkg, err = parsePackageJSONData(manifestPath, data); err != nil {
		return
	}
	stamp = installedManifestStamp{size: info.Size(), modTime: info.ModTime().UnixNano()}
	return
}

// manifestStampMatches 校验清单是否仍是缓存时的版本，命中路径只打开一次文件取属性。
func manifestStampMatches(manifestPath string, stamp installedManifestStamp) bool {
	info, err := os.Stat(manifestPath)
	if err != nil {
		return false
	}
	return info.Size() == stamp.size && info.ModTime().UnixNano() == stamp.modTime
}

// LoadInstalledPackageManifest 解析已安装包的清单文件，清单的修改时间与大小未变化时复用上次解析结果。
// 返回的包是缓存原型的独立副本，调用方可以就地写入展示字段。
func LoadInstalledPackageManifest(pkgType, installPath, manifestPath string) (pkg *Package, err error) {
	installedManifestCacheMu.RLock()
	cached, ok := installedManifestCache[pkgType][installPath]
	installedManifestCacheMu.RUnlock()
	if ok && manifestStampMatches(manifestPath, cached.stamp) {
		return ClonePackage(cached.pkg), nil
	}

	stamp, parsed, err := installedManifestReader(manifestPath)
	if nil != err {
		// 清单缺失或不可读时沿用既有错误，这类情况不写入缓存
		return nil, err
	}
	installedManifestCacheMu.Lock()
	if nil == installedManifestCache[pkgType] {
		installedManifestCache[pkgType] = map[string]installedManifestCacheEntry{}
	}
	installedManifestCache[pkgType][installPath] = installedManifestCacheEntry{stamp: stamp, pkg: parsed}
	installedManifestCacheMu.Unlock()
	return ClonePackage(parsed), nil
}

// SetInstalledPackageMetadata 设置本地集市包的通用元数据
func SetInstalledPackageMetadata(pkg *Package, installPath, baseURLPath, pkgType string) bool {
	clearBazaarPackageRating(pkg)
	pkg.InstallTime, pkg.UpdateTime = getPackageTimes(pkgType, pkg.Name, installPath)
	pkg.RepoRef = getPackageRepoRef(pkgType, pkg.Name)
	cacheVersion := installedPackageCacheVersion(pkg)
	if pkg.InvalidReason != "" {
		pkg.PreferredName = pkg.Name
		pkg.Installed = true
		pkg.HInstallDate = time.UnixMilli(pkg.InstallTime).Format("2006-01-02")
		return true
	}

	// 展示信息
	pkg.IconURL = installedPackageImageURL(installPath, baseURLPath, packageImageName(pkg.Icon, "icon.png"), cacheVersion)
	pkg.PreviewURL = installedPackageImageURL(installPath, baseURLPath, packageImageName(pkg.Preview, "preview.png"), cacheVersion)
	pkg.PreferredName = GetPreferredLocaleString(pkg.DisplayName, pkg.Name)
	pkg.PreferredDesc = GetPreferredLocaleString(pkg.Description, "")
	sourceRepoURL, sourceRepoRef := getPackageSource(pkgType, pkg.Name)
	pkg.PreferredReadme = getInstalledPackageREADME(installPath, baseURLPath, sourceRepoURL, sourceRepoRef,
		cacheVersion, pkg.Readme)
	pkg.PreferredFunding = getPreferredFunding(pkg.Funding)

	// 安装状态
	pkg.Installed = true
	pkg.DisallowInstall = isBelowRequiredAppVersion(pkg)
	// 清单中的 URL 字段不可信，仅展示 http/https 链接，防止注入 javascript: 等伪协议
	if util.IsNetworkIconURL(pkg.URL) {
		pkg.RepoURL = pkg.URL
	} else {
		pkg.RepoURL = ""
	}

	pkg.HInstallDate = time.UnixMilli(pkg.InstallTime).Format("2006-01-02")

	return true
}

// RefreshInstalledPackageREADME 使用已确认的在线版本来源重新渲染本地 README。
func RefreshInstalledPackageREADME(pkg *Package, installPath, baseURLPath, repoURL, repoRef string) {
	if pkg == nil {
		return
	}
	repoURL, repoRef = normalizeGitHubPackageSource(repoURL, repoRef)
	if repoURL == "" || repoRef == "" {
		return
	}
	pkg.PreferredReadme = getInstalledPackageREADME(installPath, baseURLPath, repoURL, repoRef,
		installedPackageCacheVersion(pkg), pkg.Readme)
	pkg.RepoRef = repoRef
}

func installedPackageCacheVersion(pkg *Package) int64 {
	ret := max(pkg.UpdateTime, pkg.InstallTime)
	return ret
}

func installedPackageImageURL(installPath, baseURLPath, imageName string, cacheVersion int64) string {
	if !isSupportedPackageImageName(imageName) {
		return ""
	}
	info, err := os.Stat(filepath.Join(installPath, imageName))
	if err != nil || !info.Mode().IsRegular() {
		return ""
	}
	ret := baseURLPath + url.PathEscape(imageName)
	if cacheVersion > 0 {
		ret += "?v=" + strconv.FormatInt(cacheVersion, 10)
	}
	return ret
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

// InvalidateInstalledPackageSizeCache 删除本地集市包的安装大小缓存
func InvalidateInstalledPackageSizeCache(pkgType, packageName string) {
	cacheKey := pkgType + ":" + packageName
	installSizeCacheMu.Lock()
	delete(installSizeCache, cacheKey)
	installSizeVersion[cacheKey]++
	installSizeCacheMu.Unlock()
	installSizeFlight.Forget(cacheKey)
}

// InvalidateInstalledPackageManifestCache 丢弃指定包的清单缓存，供安装或卸载后立即生效。
func InvalidateInstalledPackageManifestCache(pkgType, packageName string) {
	layout, ok := GetPackageLayout(pkgType)
	if !ok {
		return
	}
	installedManifestCacheMu.Lock()
	defer installedManifestCacheMu.Unlock()
	delete(installedManifestCache[pkgType], filepath.Join(layout.BasePath, packageName))
}

// RetainInstalledPackageCaches 只保留本次扫描到的安装目录，卸载后的派生缓存不再驻留。
func RetainInstalledPackageCaches(pkgType string, installPaths []string) {
	installedManifestCacheMu.Lock()
	cached := installedManifestCache[pkgType]
	if nil != cached {
		keep := make(map[string]struct{}, len(installPaths))
		for _, installPath := range installPaths {
			keep[installPath] = struct{}{}
		}
		for installPath := range cached {
			if _, ok := keep[installPath]; !ok {
				delete(cached, installPath)
			}
		}
	}
	installedManifestCacheMu.Unlock()
	if layout, ok := GetPackageLayout(pkgType); ok {
		retainInstalledPackageReadmeCache(filepath.Clean(layout.BasePath), installPaths)
	}
}

// InvalidateInstalledPackageCaches 在安装、卸载或外观同步后丢弃该包的全部派生缓存。
func InvalidateInstalledPackageCaches(pkgType, packageName string) {
	InvalidateInstalledPackageSizeCache(pkgType, packageName)
	InvalidateInstalledPackageManifestCache(pkgType, packageName)
	if layout, ok := GetPackageLayout(pkgType); ok {
		InvalidateInstalledPackageReadmeCache(filepath.Join(layout.BasePath, packageName))
	}
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
	InstallTime int64  `json:"installTime"` // 安装时间戳（毫秒）
	UpdateTime  int64  `json:"updateTime"`  // 更新时间戳（毫秒）
	RepoURL     string `json:"repoURL,omitempty"`
	RepoRef     string `json:"repoRef,omitempty"`
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
func recordPackageOperationTime(pkgType, pkgName string, operationTime, fallbackInstallTime time.Time, update bool,
	repoURL, repoRef string) {
	getBazaarInfo()
	repoURL, repoRef = normalizeGitHubPackageSource(repoURL, repoRef)

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
	p.RepoURL = repoURL
	p.RepoRef = repoRef
	saveBazaarInfo()
}

func getPackageSource(pkgType, pkgName string) (repoURL, repoRef string) {
	getBazaarInfo()
	bazaarInfoCacheLock.RLock()
	defer bazaarInfoCacheLock.RUnlock()
	if bazaarInfoCache == nil || bazaarInfoCache.Packages[pkgType] == nil {
		return
	}
	if info := bazaarInfoCache.Packages[pkgType][pkgName]; info != nil {
		return normalizeGitHubPackageSource(info.RepoURL, info.RepoRef)
	}
	return
}

func getPackageRepoRef(pkgType, pkgName string) string {
	_, repoRef := getPackageSource(pkgType, pkgName)
	return repoRef
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
