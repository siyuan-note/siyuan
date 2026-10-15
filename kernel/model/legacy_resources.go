// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"os"
	"path/filepath"
	"strings"

	"github.com/88250/gulu"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// retiredInstallResourcePaths 返回升级后仍可能残留在磁盘上的已撤回安装资源。
// 安装包与本机外观目录只增不删，历史版本的文件不会随升级自动消失，因此集中在此处统一清理。
// 历史字体不在此列：它需要确认替代字体已经可用，由 InitAppearance 在资源复制完成后处理。
func retiredInstallResourcePaths() []string {
	return []string{
		filepath.Join(util.WorkingDir, "stage", "map"),          // 已撤回的数据库地图视图静态页面
		filepath.Join(util.WorkingDir, "stage", "build", "map"), // 地图视图的构建产物
		filepath.Join(util.AppearancePath, "icons", "ant"),      // 已撤回的内置图标集
		filepath.Join(util.AppearancePath, "icons", "material"),
	}
}

// CleanupRetiredInstallResources 删除升级后残留的已撤回安装资源，随启动阶段执行。
// 这些路径都由安装包管理、不存放用户数据，直接删除目录；目录缺失时忽略。
func CleanupRetiredInstallResources() error {
	for _, p := range retiredInstallResourcePaths() {
		if err := os.RemoveAll(p); err != nil {
			return err
		}
	}
	cleanLegacyLangFiles()
	return nil
}

// cleanLegacyLangFiles 清理外观目录下下划线命名的历史 i18n 文件（zh_CN.json 等）。
// 这些文件名已在 BCP 47 命名（zh-CN.json 等）迁移后失效，继续存在只会成为僵尸文件。
func cleanLegacyLangFiles() {
	langsDir := filepath.Join(util.AppearancePath, "langs")
	if !gulu.File.IsDir(langsDir) {
		return
	}
	entries, err := os.ReadDir(langsDir)
	if err != nil {
		return
	}
	for _, entry := range entries {
		name := entry.Name()
		if entry.IsDir() || !strings.HasSuffix(name, ".json") {
			continue
		}
		if _, ok := util.LangLegacyToBCP47[strings.TrimSuffix(name, ".json")]; !ok {
			continue
		}
		os.RemoveAll(filepath.Join(langsDir, name))
	}
}
