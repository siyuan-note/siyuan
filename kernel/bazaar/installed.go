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

var packageInstallSizeCache = gcache.New(48*time.Hour, 6*time.Hour) // [repoURL]*int64

// InstalledPackages 获取已安装的指定类型集市包列表
func InstalledPackages(pkgType, frontend string) (ret []*Package) {
	ret = []*Package{}

	var basePath string
	var jsonFileName string
	var baseURLPathPrefix string
	var filterFunc func([]os.DirEntry) []os.DirEntry
	var postProcessFunc func(*Package, string)

	switch pkgType {
	case "plugins":
		basePath = filepath.Join(util.DataDir, "plugins")
		jsonFileName = "plugin.json"
		baseURLPathPrefix = "/plugins/"
		filterFunc = nil
		postProcessFunc = func(pkg *Package, frontend string) {
			// 插件不兼容性检查
			incompatible := isIncompatiblePlugin(pkg, frontend)
			pkg.Incompatible = &incompatible
		}
	case "widgets":
		basePath = filepath.Join(util.DataDir, "widgets")
		jsonFileName = "widget.json"
		baseURLPathPrefix = "/widgets/"
		filterFunc = nil
		postProcessFunc = nil
	case "icons":
		basePath = util.IconsPath
		jsonFileName = "icon.json"
		baseURLPathPrefix = "/appearance/icons/"
		filterFunc = func(dirs []os.DirEntry) []os.DirEntry {
			// 过滤内置图标
			var filteredDirs []os.DirEntry
			for _, dir := range dirs {
				if !isBuiltInIcon(dir.Name()) {
					filteredDirs = append(filteredDirs, dir)
				}
			}
			return filteredDirs
		}
		postProcessFunc = nil
	case "themes":
		basePath = util.ThemesPath
		jsonFileName = "theme.json"
		baseURLPathPrefix = "/appearance/themes/"
		filterFunc = func(dirs []os.DirEntry) []os.DirEntry {
			// 过滤内置主题
			var filteredDirs []os.DirEntry
			for _, dir := range dirs {
				if !IsBuiltInTheme(dir.Name()) {
					filteredDirs = append(filteredDirs, dir)
				}
			}
			return filteredDirs
		}
		postProcessFunc = nil
	case "templates":
		basePath = filepath.Join(util.DataDir, "templates")
		jsonFileName = "template.json"
		baseURLPathPrefix = "/templates/"
		filterFunc = nil
		postProcessFunc = nil
	default:
		logging.LogWarnf("invalid package type: %s", pkgType)
		return
	}

	dirs, err := readInstalledPackageDirs(basePath)
	if err != nil {
		logging.LogWarnf("read %s folder failed: %s", pkgType, err)
		return
	}
	if len(dirs) == 0 {
		return
	}

	// 过滤
	if filterFunc != nil {
		dirs = filterFunc(dirs)
	}

	bazaarPackagesMap := buildBazaarPackagesMap(pkgType, frontend)
	installedPackageInfos := getInstalledPackageInfos(dirs, pkgType)

	for _, info := range installedPackageInfos {
		pkg := info.Pkg
		dirName := info.DirName
		installPath := filepath.Join(basePath, dirName)
		baseURLPath := baseURLPathPrefix + dirName

		if !setPackageMetadata(pkg, installPath, jsonFileName, baseURLPath, bazaarPackagesMap) {
			continue
		}

		// 额外处理
		if postProcessFunc != nil {
			postProcessFunc(pkg, frontend)
		}

		ret = append(ret, pkg)
	}
	return
}

// readInstalledPackageDirs 读取已安装包的目录列表
func readInstalledPackageDirs(basePath string) ([]os.DirEntry, error) {
	if !util.IsPathRegularDirOrSymlinkDir(basePath) {
		return []os.DirEntry{}, nil
	}

	dirs, err := os.ReadDir(basePath)
	if err != nil {
		return nil, err
	}

	return dirs, nil
}

// buildBazaarPackagesMap 获取指定类型的集市包并转换为按包名索引的映射表
func buildBazaarPackagesMap(pkgType string, frontend string) map[string]*Package {
	packages := Packages(pkgType, frontend)
	result := make(map[string]*Package, len(packages))
	for _, pkg := range packages {
		if "" != pkg.Name {
			result[pkg.Name] = pkg
		}
	}
	return result
}

// getInstalledPackageInfos 获取已安装包信息
func getInstalledPackageInfos(dirs []os.DirEntry, parsePkgType string) []InstalledPackageInfo {
	var result []InstalledPackageInfo
	for _, dir := range dirs {
		if !util.IsDirRegularOrSymlink(dir) {
			continue
		}
		dirName := dir.Name()

		pkg, parseErr := ParsePackageJSON(parsePkgType, dirName)
		if nil != parseErr || nil == pkg {
			continue
		}

		result = append(result, InstalledPackageInfo{Pkg: pkg, DirName: dirName})
	}
	return result
}

// setPackageMetadata 设置包的元数据
func setPackageMetadata(pkg *Package, installPath, jsonFileName, baseURLPath string, bazaarPackagesMap map[string]*Package) bool {
	info, statErr := os.Stat(filepath.Join(installPath, jsonFileName))
	if nil != statErr {
		logging.LogWarnf("stat install %s failed: %s", jsonFileName, statErr)
		return false
	}

	// 展示信息
	pkg.PreviewURL = baseURLPath + "/preview.png"
	pkg.PreviewURLThumb = baseURLPath + "/preview.png"
	pkg.IconURL = baseURLPath + "/icon.png"
	pkg.PreferredName = GetPreferredLocaleString(pkg.DisplayName, pkg.Name)
	pkg.PreferredDesc = GetPreferredLocaleString(pkg.Description, "")
	pkg.PreferredReadme = getPackageLocalREADME(installPath, baseURLPath+"/", pkg.Readme)
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

func IsBuiltInTheme(dirName string) bool {
	return "daylight" == dirName || "midnight" == dirName
}

func isBuiltInIcon(dirName string) bool {
	return "ant" == dirName || "material" == dirName
}
