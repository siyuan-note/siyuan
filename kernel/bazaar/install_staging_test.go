// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package bazaar

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestInstallPackageExtractionIsProtected(t *testing.T) {
	useInstallTempDir(t)
	data := buildInstallPackageArchive(t, map[string]string{
		"plugin.json": `{"name":"sample","version":"1.0.0"}`,
		"index.js":    "approved",
	})
	checked := false
	options := PackageInstallOptions{Recheck: func() error {
		paths, err := filepath.Glob(filepath.Join(util.TempDir, "bazaar", "package", "online-*", "index.js"))
		if err != nil || len(paths) == 0 {
			return err
		}
		checked = true
		if !util.IsForbiddenAbsPath(paths[0]) || !util.IsPluginDevelopmentRawPathForbidden(filepath.Dir(paths[0]), true) {
			return fmt.Errorf("online extraction is accessible through raw file APIs")
		}
		return nil
	}}
	if _, err := installPackageWithOptions(data, filepath.Join(t.TempDir(), "sample"), "plugins", "sample", false, options); err != nil {
		t.Fatal(err)
	}
	if !checked {
		t.Fatal("online extraction was not inspected")
	}
}

func TestInstallPackageStagingReleasesInstallLock(t *testing.T) {
	source, target := useInstallRevisionFixture(t)
	checked := false
	options := PackageInstallOptions{Recheck: func() error {
		paths, err := filepath.Glob(filepath.Join(filepath.Dir(target), ".siyuan-package-install-*", "staging", "index.js"))
		if err != nil || len(paths) == 0 || checked {
			return err
		}
		checked = true
		if !packageInstallLock.TryAcquire(1) {
			return fmt.Errorf("staging held the install lock")
		}
		packageInstallLock.Release(1)
		return nil
	}}
	if _, err := replacePackageDirectoryWithOptions(source, target, true, options); err != nil {
		t.Fatal(err)
	}
	if !checked {
		t.Fatal("staging was not inspected")
	}
	// 提交后的锁仍可获取，避免初始版本读取与提交两段加锁泄漏许可。
	if !packageInstallLock.TryAcquire(1) {
		t.Fatal("install lock was retained after commit")
	}
	packageInstallLock.Release(1)
}

// useInstallTempDir 把解压目录指向独立临时目录，避免写入工作空间 temp
func useInstallTempDir(t *testing.T) {
	t.Helper()
	oldTempDir := util.TempDir
	util.TempDir = t.TempDir()
	t.Cleanup(func() { util.TempDir = oldTempDir })
}

// TestInstallPackageFlattensSingleTopLevelDirectory 校验归档带唯一顶层目录时安装的是包根内容
func TestInstallPackageFlattensSingleTopLevelDirectory(t *testing.T) {
	useInstallTempDir(t)
	data := buildInstallPackageArchive(t, map[string]string{
		"wrapper/plugin.json":  `{"name":"sample","version":"1.0.0"}`,
		"wrapper/index.js":     "new",
		"wrapper/i18n/en.json": `{}`,
	})
	installPath := filepath.Join(t.TempDir(), "plugins", "sample")
	if err := installPackage(data, installPath, "plugins", "sample", false); err != nil {
		t.Fatalf("expected wrapped archive to install: %s", err)
	}
	if _, err := os.Stat(filepath.Join(installPath, "index.js")); err != nil {
		t.Fatalf("package root was not flattened: %s", err)
	}
	if _, err := os.Stat(filepath.Join(installPath, "wrapper")); !os.IsNotExist(err) {
		t.Fatalf("wrapper directory reached the install path: %v", err)
	}
	entries, err := os.ReadDir(filepath.Dir(installPath))
	if err != nil || len(entries) != 1 || entries[0].Name() != "sample" {
		t.Fatalf("temporary installation directory was not cleaned up: %#v, %v", entries, err)
	}
}

// TestInstallPackageValidatesBeforeTouchingInstallRoot 校验包名不符时不会在 data 下创建任何内容
// https://github.com/siyuan-note/siyuan/security/advisories/GHSA-rpx2-p6hp-x5gj
func TestInstallPackageValidatesBeforeTouchingInstallRoot(t *testing.T) {
	useInstallTempDir(t)
	installRoot := t.TempDir()
	data := buildInstallPackageArchive(t, map[string]string{
		"plugin.json": `{"name":"attacker-plugin","version":"1.0.0"}`,
		"index.js":    "malicious",
	})
	installPath := filepath.Join(installRoot, "plugins", "trusted-plugin")
	if err := installPackage(data, installPath, "plugins", "trusted-plugin", false); err == nil {
		t.Fatal("expected name mismatch to be rejected")
	}
	if _, err := os.Stat(filepath.Join(installRoot, "plugins")); !os.IsNotExist(err) {
		t.Fatalf("rejected package reached the install root: %v", err)
	}
}

// TestInstallPackageCleansTempExtraction 校验解压产生的临时目录在安装后被清理
func TestInstallPackageCleansTempExtraction(t *testing.T) {
	useInstallTempDir(t)
	data := buildInstallPackageArchive(t, map[string]string{
		"plugin.json": `{"name":"sample","version":"1.0.0"}`,
		"index.js":    "new",
	})
	installPath := filepath.Join(t.TempDir(), "plugins", "sample")
	if err := installPackage(data, installPath, "plugins", "sample", false); err != nil {
		t.Fatalf("expected fresh install to succeed: %s", err)
	}
	entries, err := os.ReadDir(filepath.Join(util.TempDir, "bazaar", "package"))
	if err != nil {
		t.Fatalf("read temp package root: %s", err)
	}
	if len(entries) != 0 {
		t.Fatalf("temp extraction was retained: %#v", entries)
	}
}

// TestPackageLayoutCoversAllManifests 校验包类型布局与清单映射保持单一来源
func TestPackageLayoutCoversAllManifests(t *testing.T) {
	for manifest, pkgType := range localPackageManifests {
		layout, ok := GetPackageLayout(pkgType)
		if !ok {
			t.Fatalf("package type [%s] has no layout", pkgType)
		}
		// BasePath 依赖工作空间路径，测试环境可能为空；清单与访问路径必须始终可用
		if layout.Manifest != manifest || layout.URLPath == "" {
			t.Fatalf("layout of [%s] = %+v", pkgType, layout)
		}
	}
	if _, ok := GetPackageLayout("unknown"); ok {
		t.Fatal("unknown package type accepted")
	}
}
