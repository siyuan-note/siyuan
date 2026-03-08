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
	gcache "github.com/patrickmn/go-cache"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/util"
	"golang.org/x/mod/semver"
	"golang.org/x/sync/singleflight"
)

// packageInstallSizeCache 缓存集市包的安装大小，与 cachedStageIndex 使用相同的缓存时间
var packageInstallSizeCache = gcache.New(time.Duration(util.RhyCacheDuration)*time.Second, time.Duration(util.RhyCacheDuration)*time.Second/6) // [repoURL]*int64

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
func SetInstalledPackageMetadata(pkg *Package, installPath, baseURLPath, pkgType string, bazaarPackagesMap map[string]*Package) bool {
	// 展示信息
	pkg.IconURL = baseURLPath + "icon.png"
	pkg.PreviewURL = baseURLPath + "preview.png"
	pkg.PreferredName = GetPreferredLocaleString(pkg.DisplayName, pkg.Name)
	pkg.PreferredDesc = GetPreferredLocaleString(pkg.Description, "")
	pkg.PreferredReadme = getInstalledPackageREADME(installPath, baseURLPath, pkg.Readme)
	pkg.PreferredFunding = getPreferredFunding(pkg.Funding)

	// 更新信息
	pkg.Installed = true
	pkg.DisallowInstall = isBelowRequiredAppVersion(pkg)
	if bazaarPkg := bazaarPackagesMap[pkg.Name]; nil != bazaarPkg {
		pkg.DisallowUpdate = isBelowRequiredAppVersion(bazaarPkg)
		pkg.UpdateRequiredMinAppVer = bazaarPkg.MinAppVersion
		pkg.RepoURL = bazaarPkg.RepoURL // 更新链接使用在线数据，避免本地元数据的链接错误

		if 0 > semver.Compare("v"+pkg.Version, "v"+bazaarPkg.Version) {
			pkg.RepoHash = bazaarPkg.RepoHash
			pkg.Outdated = true
		}
	} else {
		pkg.RepoURL = pkg.URL
	}

	// 安装信息
	pkg.HInstallDate = getPackageHInstallDate(pkgType, pkg.Name, installPath)
	// TODO 本地安装大小的缓存改成 1 分钟有效，打开集市包 README 的时候才遍历集市包文件夹进行统计，异步返回结果到前端显示 https://github.com/siyuan-note/siyuan/issues/16983
	// 目前优先使用在线 stage 数据：不耗时，但可能不准确，比如本地旧版本与云端最新版本的安装大小可能不一致；其次使用本地目录大小：耗时，但准确
	if installSize, ok := packageInstallSizeCache.Get(pkg.RepoURL); ok {
		pkg.InstallSize = installSize.(int64)
	} else {
		size, _ := util.SizeOfDirectory(installPath)
		pkg.InstallSize = size
		packageInstallSizeCache.SetDefault(pkg.RepoURL, size)
	}
	pkg.HInstallSize = humanize.BytesCustomCeil(uint64(pkg.InstallSize), 2)

	return true
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

// BazaarInfo 集市的持久化信息
type BazaarInfo struct {
	Packages map[string]map[string]*PackageInfo `json:"packages"`
}

// PackageInfo 集市包的持久化信息
type PackageInfo struct {
	InstallTime int64 `json:"installTime"` // 安装时间戳（毫秒）
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

	_, _, _ = bazaarInfoSingleFlight.Do("loadBazaarInfo", func() (interface{}, error) {
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

// saveBazaarInfo 保存集市持久化信息（调用者需持有写锁）
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

// setPackageInstallTime 设置集市包的安装时间
func setPackageInstallTime(pkgType, pkgName string, installTime time.Time) {
	getBazaarInfo()

	bazaarInfoCacheLock.Lock()
	defer bazaarInfoCacheLock.Unlock()

	if bazaarInfoCache == nil {
		return
	}
	if bazaarInfoCache.Packages[pkgType] == nil {
		bazaarInfoCache.Packages[pkgType] = make(map[string]*PackageInfo)
	}
	p := bazaarInfoCache.Packages[pkgType][pkgName]
	if p == nil {
		p = &PackageInfo{}
		bazaarInfoCache.Packages[pkgType][pkgName] = p
	}
	p.InstallTime = installTime.UnixMilli()
	saveBazaarInfo()
}

// getPackageHInstallDate 获取集市包的安装日期
func getPackageHInstallDate(pkgType, pkgName, installPath string) string {
	getBazaarInfo()
	bazaarInfoCacheLock.RLock()
	var installTime int64
	if bazaarInfoCache != nil && bazaarInfoCache.Packages[pkgType] != nil {
		if p := bazaarInfoCache.Packages[pkgType][pkgName]; p != nil {
			installTime = p.InstallTime
		}
	}
	bazaarInfoCacheLock.RUnlock()

	if installTime > 0 {
		return time.UnixMilli(installTime).Format("2006-01-02")
	}

	// 如果 bazaar.json 中没有记录，使用文件夹修改时间并记录到 bazaar.json 中
	fi, err := os.Stat(installPath)
	if err != nil {
		logging.LogWarnf("stat install package folder [%s] failed: %s", installPath, err)
		return time.Now().Format("2006-01-02")
	}
	setPackageInstallTime(pkgType, pkgName, fi.ModTime())

	return fi.ModTime().Format("2006-01-02")
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
