// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestCleanupRetiredInstallResources(t *testing.T) {
	workingDir, appearancePath := t.TempDir(), t.TempDir()
	previousWorkingDir, previousAppearancePath := util.WorkingDir, util.AppearancePath
	util.WorkingDir, util.AppearancePath = workingDir, appearancePath
	t.Cleanup(func() {
		util.WorkingDir, util.AppearancePath = previousWorkingDir, previousAppearancePath
	})

	// 已撤回资源与同层仍在使用的资源
	retired := []string{
		filepath.Join(workingDir, "stage", "map", "index.html"),
		filepath.Join(workingDir, "stage", "build", "map", "maplibre-gl.js"),
		filepath.Join(appearancePath, "icons", "ant", "icon.js"),
		filepath.Join(appearancePath, "icons", "material", "icon.js"),
		filepath.Join(appearancePath, "langs", "zh_CN.json"),
	}
	kept := []string{
		filepath.Join(workingDir, "stage", "build", "desktop", "index.js"),
		filepath.Join(workingDir, "stage", "map-icons", "pin.svg"),
		filepath.Join(appearancePath, "icons", "litheness", "icon.js"),
		filepath.Join(appearancePath, "langs", "zh-CN.json"),
		// 历史字体要求替代字体可用，由 InitAppearance 在资源复制后单独处理，不在本函数职责内
		filepath.Join(appearancePath, "fonts", "JetBrainsMono-1.0.3", "JetBrainsMono-Regular.woff"),
	}
	for _, p := range append(append([]string{}, retired...), kept...) {
		if err := os.MkdirAll(filepath.Dir(p), 0755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte("fixture"), 0644); err != nil {
			t.Fatal(err)
		}
	}

	if err := CleanupRetiredInstallResources(); err != nil {
		t.Fatal(err)
	}

	for _, p := range retired {
		if _, err := os.Lstat(p); !os.IsNotExist(err) {
			t.Fatalf("retired resource remains: %s", p)
		}
	}
	for _, p := range kept {
		if _, err := os.Stat(p); err != nil {
			t.Fatalf("ordinary resource removed: %s", p)
		}
	}
	// 目录已不存在时重复执行不报错
	if err := CleanupRetiredInstallResources(); err != nil {
		t.Fatal("retry", err)
	}
}

func TestCleanupRetiredInstallResourcesMissingDirsAndLinks(t *testing.T) {
	workingDir, appearancePath := t.TempDir(), t.TempDir()
	previousWorkingDir, previousAppearancePath := util.WorkingDir, util.AppearancePath
	util.WorkingDir, util.AppearancePath = workingDir, appearancePath
	t.Cleanup(func() {
		util.WorkingDir, util.AppearancePath = previousWorkingDir, previousAppearancePath
	})

	// 安装目录不含已撤回资源时直接返回
	if err := CleanupRetiredInstallResources(); err != nil {
		t.Fatal(err)
	}

	outside := t.TempDir()
	if err := os.WriteFile(filepath.Join(outside, "private"), []byte("private"), 0644); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(appearancePath, "icons", "ant")
	if err := os.MkdirAll(filepath.Dir(link), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, link); err != nil {
		t.Skipf("symlink unavailable: %v", err)
	}

	if err := CleanupRetiredInstallResources(); err != nil {
		t.Fatal(err)
	}
	// 只删除链接本身，链接指向的目录内容保持原样
	if _, err := os.Lstat(link); !os.IsNotExist(err) {
		t.Fatalf("link remains: %v", err)
	}
	if data, err := os.ReadFile(filepath.Join(outside, "private")); err != nil || string(data) != "private" {
		t.Fatalf("changed linked content: %v", err)
	}
}
