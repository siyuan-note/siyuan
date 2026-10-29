// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package bazaar

import (
	"errors"
	"os"
	"path/filepath"

	"github.com/siyuan-note/siyuan/kernel/util"
)

// PackageLayout 描述一类集市包在文件系统中的安装布局。
type PackageLayout struct {
	BasePath string // 安装目录的父目录
	Manifest string // 清单文件名
	URLPath  string // 前端访问该包目录的路径前缀
}

// GetPackageLayout 集中维护包类型到安装目录、清单文件名和访问路径的映射。
// 清单文件名始终由 localPackageManifests 反查，避免同一映射散落在多处。
func GetPackageLayout(pkgType string) (layout PackageLayout, ok bool) {
	var basePath, urlPath string
	switch pkgType {
	case "plugins":
		basePath, urlPath = filepath.Join(util.DataDir, "plugins"), "/plugins/"
	case "themes":
		basePath, urlPath = util.ThemesPath, "/appearance/themes/"
	case "icons":
		basePath, urlPath = util.IconsPath, "/appearance/icons/"
	case "templates":
		basePath, urlPath = filepath.Join(util.DataDir, "templates"), "/templates/"
	case "widgets":
		basePath, urlPath = filepath.Join(util.DataDir, "widgets"), "/widgets/"
	default:
		return PackageLayout{}, false
	}
	for manifest, packageType := range localPackageManifests {
		if packageType == pkgType {
			return PackageLayout{BasePath: basePath, Manifest: manifest, URLPath: urlPath}, true
		}
	}
	return PackageLayout{}, false
}

// makePackageExtractionDir 在受文件访问守卫保护的临时根下创建独占目录，并拒绝空间内部的链接。
func makePackageExtractionDir(kind, pattern string) (string, error) {
	if !filepath.IsAbs(util.TempDir) {
		return "", errors.New("package extraction root is unavailable")
	}
	root := filepath.Join(util.TempDir, "bazaar", kind)
	if err := rejectInstallPathLinks(root); err != nil {
		return "", err
	}
	if err := os.MkdirAll(root, 0755); err != nil {
		return "", err
	}
	if err := rejectInstallPathLinks(root); err != nil {
		return "", err
	}
	return os.MkdirTemp(root, pattern)
}

func rejectInstallPathLinks(target string) error {
	target, err := filepath.Abs(target)
	if err != nil {
		return err
	}
	workspace := ""
	if util.WorkspaceDir != "" && filepath.IsAbs(util.WorkspaceDir) {
		workspace = filepath.Clean(util.WorkspaceDir)
	}
	for current := target; ; current = filepath.Dir(current) {
		if workspace != "" {
			if relative, relErr := filepath.Rel(workspace, current); relErr == nil && relative == "." {
				// 用户选择的工作空间及其祖先可使用链接，空间内部的操作路径仍须逐层拒绝链接。
				info, statErr := os.Stat(current)
				if statErr != nil {
					return statErr
				}
				if !info.IsDir() {
					return errors.New("package operation workspace must be a directory")
				}
				return nil
			}
		}
		info, err := os.Lstat(current)
		if err != nil && !os.IsNotExist(err) {
			return err
		}
		if err == nil && (info.Mode()&os.ModeSymlink != 0 || !info.IsDir()) {
			return errors.New("package operation path must contain only regular directories")
		}
		if filepath.Dir(current) == current {
			return nil
		}
	}
}
