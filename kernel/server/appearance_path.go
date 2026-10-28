// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package server

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/88250/gulu"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// resolveAppearanceFile 在读取前限定真实路径，仅允许主题和图标包目录链接到外部目录。
func resolveAppearanceFile(root, requestPath string) (string, int) {
	filePath, status := resolveAppearanceFilePath(root, requestPath)
	if replacement := util.LegacyFontReplacement(requestPath); status == 0 && replacement != "" {
		if _, err := os.Lstat(filePath); os.IsNotExist(err) {
			// 已存在的用户文件优先，仅为缺失的历史字体提供替代资源，并复用路径边界校验。
			return resolveAppearanceFilePath(root, replacement)
		}
	}
	return filePath, status
}

func resolveAppearanceFilePath(root, requestPath string) (string, int) {
	relativePath, ok := cleanStaticRelativePath(requestPath)
	if !ok {
		return "", http.StatusForbidden
	}
	// 启动页目录映射到首页，首页仍需经过完整的路径和符号链接校验。
	if relativePath == "boot" {
		relativePath = filepath.Join(relativePath, "index.html")
	}
	segments := strings.Split(filepath.ToSlash(relativePath), "/")
	packageRootIndex := -1
	kind := strings.ToLower(segments[0])
	if len(segments) >= 2 && (kind == "themes" || kind == "icons") {
		packagePath := util.AppearancePackagePath(kind, segments[1])
		if packagePath == "" {
			return "", http.StatusForbidden
		}
		root = filepath.Dir(packagePath)
		segments[1] = filepath.Base(packagePath)
		segments = segments[1:]
		packageRootIndex = 0
	}
	root, err := filepath.Abs(root)
	if err != nil {
		return "", http.StatusInternalServerError
	}
	resolvedRoot, err := evalAppearanceSymlinks(root)
	if err != nil {
		logging.LogWarnf("resolve appearance root [%s] failed: %s", root, err)
		logAppearanceRootDiagnostic(root, filepath.Join(append([]string{root}, segments...)...))
		return "", http.StatusNotFound
	}
	root = resolvedRoot
	allowedRoot, target := root, root
	for i, segment := range segments {
		target = filepath.Join(target, segment)
		info, statErr := os.Lstat(target)
		if os.IsNotExist(statErr) {
			// 保留缺失主题脚本的空响应和缺失语言包的英文补全行为。
			return filepath.Join(append([]string{target}, segments[i+1:]...)...), 0
		}
		if statErr != nil {
			logging.LogWarnf("stat appearance resource [%s] failed: %s", target, statErr)
			return "", http.StatusForbidden
		}
		// Windows 目录联接可能标记为 ModeIrregular，同样需要检查真实路径。
		if info.Mode()&(os.ModeSymlink|os.ModeIrregular) != 0 {
			resolvedTarget, resolveErr := evalAppearanceSymlinks(target)
			if resolveErr != nil {
				logging.LogWarnf("resolve appearance link [%s] failed: %s", target, resolveErr)
				return "", http.StatusForbidden
			}
			target = resolvedTarget
		}
		if i == packageRootIndex {
			info, err = os.Stat(target)
			if err != nil || !info.IsDir() {
				return "", http.StatusNotFound
			}
			allowedRoot = target
		}
		if target != allowedRoot && !gulu.File.IsSubPath(allowedRoot, target) {
			return "", http.StatusForbidden
		}
	}
	info, err := os.Stat(target)
	if err != nil || !info.Mode().IsRegular() {
		return "", http.StatusNotFound
	}
	return target, 0
}
