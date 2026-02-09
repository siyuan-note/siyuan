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
	"path"
	"path/filepath"
	"strings"
	"time"

	"github.com/88250/go-humanize"
	gcache "github.com/patrickmn/go-cache"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/util"
	"golang.org/x/mod/semver"
)

// InstalledPackageInfo 表示已安装包的信息
type InstalledPackageInfo struct {
	Pkg     *Package
	DirName string
}

// packageInstallSizeCache 缓存集市包的安装大小，与 cachedStageIndex 使用相同的缓存时间
var packageInstallSizeCache = gcache.New(time.Duration(util.RhyCacheDuration)*time.Second, time.Duration(util.RhyCacheDuration)*time.Second/6) // [repoURL]*int64

// FilterPackages 按关键词过滤集市包列表
func FilterPackages(packages []*Package, keyword string) []*Package {
	keywords := getSearchKeywords(keyword)
	if 0 == len(keywords) {
		return packages
	}
	ret := []*Package{}
	for _, pkg := range packages {
		if matchPackage(keywords, pkg) {
			ret = append(ret, pkg)
		}
	}
	return ret
}

func getSearchKeywords(query string) (ret []string) {
	query = strings.TrimSpace(query)
	if "" == query {
		return
	}
	keywords := strings.Split(query, " ")
	for _, k := range keywords {
		if "" != k {
			ret = append(ret, strings.ToLower(k))
		}
	}
	return
}

func matchPackage(keywords []string, pkg *Package) bool {
	if 1 > len(keywords) {
		return true
	}
	if nil == pkg {
		return false
	}
	for _, kw := range keywords {
		if !packageContainsKeyword(pkg, kw) {
			return false
		}
	}
	return true
}

func packageContainsKeyword(pkg *Package, kw string) bool {
	if strings.Contains(strings.ToLower(path.Base(pkg.RepoURL)), kw) ||
		strings.Contains(strings.ToLower(pkg.Author), kw) {
		return true
	}
	for _, s := range pkg.DisplayName {
		if strings.Contains(strings.ToLower(s), kw) {
			return true
		}
	}
	for _, s := range pkg.Description {
		if strings.Contains(strings.ToLower(s), kw) {
			return true
		}
	}
	for _, s := range pkg.Keywords {
		if strings.Contains(strings.ToLower(s), kw) {
			return true
		}
	}
	return false
}

// ReadInstalledPackageDirs 读取已安装包的目录列表
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

// GetInstalledPackageInfos 获取已安装包信息
func GetInstalledPackageInfos(dirs []os.DirEntry, basePath, jsonFileName string) []InstalledPackageInfo {
	var result []InstalledPackageInfo
	for _, dir := range dirs {
		dirName := dir.Name()
		pkg, parseErr := ParsePackageJSON(filepath.Join(basePath, dirName, jsonFileName))
		if nil != parseErr || nil == pkg {
			continue
		}

		result = append(result, InstalledPackageInfo{Pkg: pkg, DirName: dirName})
	}
	return result
}

// SetInstalledPackageMetadata 设置本地集市包的本地元数据
func SetInstalledPackageMetadata(pkg *Package, installPath, jsonFileName, baseURLPath string, bazaarPackagesMap map[string]*Package) bool {
	info, statErr := os.Stat(filepath.Join(installPath, jsonFileName))
	if nil != statErr {
		logging.LogWarnf("stat install %s failed: %s", jsonFileName, statErr)
		return false
	}

	// 展示信息
	pkg.IconURL = baseURLPath + "icon.png"
	pkg.PreviewURL = baseURLPath + "preview.png"
	pkg.PreferredName = GetPreferredLocaleString(pkg.DisplayName, pkg.Name)
	pkg.PreferredDesc = GetPreferredLocaleString(pkg.Description, "")
	pkg.PreferredReadme = getInstalledPackageREADME(installPath, baseURLPath, pkg.Readme)
	pkg.PreferredFunding = getPreferredFunding(pkg.Funding)

	// 更新信息
	pkg.RepoURL = pkg.URL
	pkg.DisallowInstall = isBelowRequiredAppVersion(pkg)
	if bazaarPkg := bazaarPackagesMap[pkg.Name]; nil != bazaarPkg {
		pkg.DisallowUpdate = isBelowRequiredAppVersion(bazaarPkg)
		pkg.UpdateRequiredMinAppVer = bazaarPkg.MinAppVersion
		pkg.RepoURL = bazaarPkg.RepoURL
	}
	pkg.Outdated = isOutdatedPackage(bazaarPackagesMap, pkg)
	pkg.Installed = true

	// 安装信息
	pkg.HInstallDate = info.ModTime().Format("2006-01-02")
	// TODO 本地安装大小的缓存改成 1 分钟有效，打开集市包 README 的时候才遍历集市包文件夹进行统计，异步返回结果到前端显示
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

func isOutdatedPackage(bazaarPackagesMap map[string]*Package, pkg *Package) bool {
	if !strings.HasPrefix(pkg.URL, "https://github.com/") {
		return false
	}

	repo := strings.TrimPrefix(pkg.URL, "https://github.com/")
	parts := strings.Split(repo, "/")
	if 2 != len(parts) || "" == strings.TrimSpace(parts[1]) {
		return false
	}

	if bazaarPkg, ok := bazaarPackagesMap[pkg.Name]; ok {
		if 0 > semver.Compare("v"+pkg.Version, "v"+bazaarPkg.Version) {
			pkg.RepoHash = bazaarPkg.RepoHash
			return true
		}
	}
	return false
}

// IsBuiltInTheme 通过包名或目录名判断是否为内置主题
func IsBuiltInTheme(name string) bool {
	return "daylight" == name || "midnight" == name
}

// IsBuiltInIcon 通过包名或目录名判断是否为内置图标
func IsBuiltInIcon(name string) bool {
	return "ant" == name || "material" == name
}
