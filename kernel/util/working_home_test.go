// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

package util

import (
	"flag"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestSetHomeDir(t *testing.T) {
	originalHome, originalOverride := HomeDir, homeDirOverridden
	t.Cleanup(func() { HomeDir, homeDirOverridden = originalHome, originalOverride })
	if err := SetHomeDir(""); err != nil || HomeDir != originalHome || homeDirOverridden != originalOverride {
		t.Fatalf("empty home directory changed the default: home=%q, err=%v", HomeDir, err)
	}

	base := t.TempDir()
	cwd, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	relative, err := filepath.Rel(cwd, filepath.Join(base, "relative-home"))
	if err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{filepath.Join(base, "absolute-home"), relative} {
		if err = SetHomeDir(path); err != nil {
			t.Fatalf("SetHomeDir(%q): %v", path, err)
		}
		want, _ := filepath.Abs(path)
		if HomeDir != want || !homeDirOverridden {
			t.Fatalf("home=%q, overridden=%v, want %q", HomeDir, homeDirOverridden, want)
		}
		if stat, err := os.Stat(filepath.Join(HomeDir, ".config", "siyuan")); err != nil || !stat.IsDir() {
			t.Fatalf("configuration directory was not created: %v", err)
		}
	}
}

func TestSetHomeDirRejectsInvalidPaths(t *testing.T) {
	originalHome, originalOverride := HomeDir, homeDirOverridden
	t.Cleanup(func() { HomeDir, homeDirOverridden = originalHome, originalOverride })
	base := t.TempDir()
	file := filepath.Join(base, "file")
	if err := os.WriteFile(file, []byte("unchanged"), 0600); err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{file, filepath.Join(file, "child"), "invalid\x00path"} {
		if err := SetHomeDir(path); err == nil {
			t.Fatalf("SetHomeDir(%q) accepted an invalid directory", path)
		}
		if HomeDir != originalHome || homeDirOverridden != originalOverride {
			t.Fatal("invalid directory changed the active home")
		}
	}
	data, err := os.ReadFile(file)
	if err != nil || string(data) != "unchanged" {
		t.Fatalf("existing file changed: %q, %v", data, err)
	}
}

func TestSetHomeDirRejectsReadOnlyDirectory(t *testing.T) {
	if runtime.GOOS == "windows" || os.Geteuid() == 0 {
		t.Skip("permission-bit check requires a non-root Unix user")
	}
	originalHome, originalOverride := HomeDir, homeDirOverridden
	t.Cleanup(func() { HomeDir, homeDirOverridden = originalHome, originalOverride })
	path := t.TempDir()
	if err := os.Chmod(path, 0500); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chmod(path, 0700) })
	if err := SetHomeDir(path); err == nil {
		t.Fatal("read-only home directory should fail")
	}
	if HomeDir != originalHome {
		t.Fatal("failed initialization changed the active home")
	}
}

func TestDefaultWorkspacePath(t *testing.T) {
	for _, test := range []struct {
		name, goos, profile string
		override            bool
		want                string
	}{
		{"linux default", "linux", "profile", false, filepath.Join("home", "SiYuan")},
		{"linux override", "linux", "profile", true, filepath.Join("home", "SiYuan")},
		{"windows default", "windows", "profile", false, filepath.Join("profile", "SiYuan")},
		{"windows no profile", "windows", "", false, filepath.Join("home", "SiYuan")},
		{"windows override", "windows", "profile", true, filepath.Join("home", "SiYuan")},
		{"mac default", "darwin", "profile", false, filepath.Join("home", "Library", "Application Support", "SiYuan")},
		{"mac override", "darwin", "profile", true, filepath.Join("home", "Library", "Application Support", "SiYuan")},
	} {
		t.Run(test.name, func(t *testing.T) {
			if got := defaultWorkspacePath("home", test.goos, test.profile, test.override); got != test.want {
				t.Fatalf("default workspace=%q, want %q", got, test.want)
			}
		})
	}
}

func TestBootHomeDir(t *testing.T) {
	base := t.TempDir()
	oldHome, home := filepath.Join(base, "system-home"), filepath.Join(base, "configured-home")
	workspace, wd := filepath.Join(base, "workspace"), filepath.Join(base, "resources")
	for _, dir := range []string{oldHome, workspace, wd} {
		if err := os.MkdirAll(dir, 0755); err != nil {
			t.Fatal(err)
		}
	}
	if runtime.GOOS != "windows" {
		if err := os.Chmod(oldHome, 0500); err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _ = os.Chmod(oldHome, 0700) })
	}
	command := exec.Command(os.Args[0], "-test.run=^TestBootHomeDirProcess$", "--",
		"--home-dir="+home, "--workspace="+workspace, "--wd="+wd)
	command.Env = append(os.Environ(), "SIYUAN_TEST_BOOT_HOME="+oldHome)
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("Boot() failed: %v\n%s", err, output)
	}
	for _, expected := range []string{"HOME_DIR=" + home, "WORKSPACE=" + workspace, "WD=" + wd} {
		if !strings.Contains(string(output), expected) {
			t.Fatalf("missing %q in Boot() output:\n%s", expected, output)
		}
	}
	registry := filepath.Join(home, ".config", "siyuan", "workspace.json")
	if _, err = os.Stat(registry); err != nil {
		t.Fatalf("workspace registry was not written under the configured home: %v", err)
	}
	if entries, err := os.ReadDir(oldHome); err != nil || len(entries) != 0 {
		t.Fatalf("system home was accessed for writes: entries=%v, err=%v", entries, err)
	}
}

// TestBootHomeDirProcess 只在测试子进程中初始化路径，不启动 HTTP 服务或数据库。
func TestBootHomeDirProcess(t *testing.T) {
	oldHome := os.Getenv("SIYUAN_TEST_BOOT_HOME")
	if oldHome == "" {
		return
	}
	HomeDir, systemHomeDir = oldHome, oldHome
	for i, arg := range os.Args {
		if arg == "--" {
			os.Args = append([]string{os.Args[0]}, os.Args[i+1:]...)
			break
		}
	}
	flag.CommandLine = flag.NewFlagSet("home-dir-test", flag.ExitOnError)
	Boot()
	defer UnlockWorkspace()
	fmt.Printf("HOME_DIR=%s\nWORKSPACE=%s\nWD=%s\n", HomeDir, WorkspaceDir, WorkingDir)
}

func TestIsSensitivePathWithHomeDirOverride(t *testing.T) {
	originalHome, originalSystem, originalWorkspace := HomeDir, systemHomeDir, WorkspaceDir
	originalOverride := homeDirOverridden
	t.Cleanup(func() {
		HomeDir, systemHomeDir, WorkspaceDir = originalHome, originalSystem, originalWorkspace
		homeDirOverridden = originalOverride
	})
	// 使用虚构路径验证匹配，不读取系统或用户凭据。
	systemHomeDir = filepath.Join(string(filepath.Separator), "home", "system-user")
	HomeDir = filepath.Join(string(filepath.Separator), "home", "configured-user")
	homeDirOverridden = true
	WorkspaceDir = filepath.Join(HomeDir, "SiYuan")
	for _, home := range []string{systemHomeDir, HomeDir} {
		for _, rel := range []string{filepath.Join(".ssh", "config"), filepath.Join(".config", "siyuan", "cookie.key"), ".netrc", ".npmrc"} {
			if path := filepath.Join(home, rel); !IsSensitivePath(path) {
				t.Errorf("credential path is no longer protected: %s", path)
			}
		}
	}
	if path := filepath.Join(WorkspaceDir, "data", "assets", "image.png"); IsSensitivePath(path) {
		t.Errorf("ordinary workspace asset should remain accessible: %s", path)
	}
}

func TestIsSensitivePathHomeDirOverrideWorkspaceAlias(t *testing.T) {
	originalHome, originalSystem, originalWorkspace := HomeDir, systemHomeDir, WorkspaceDir
	originalOverride := homeDirOverridden
	t.Cleanup(func() {
		HomeDir, systemHomeDir, WorkspaceDir = originalHome, originalSystem, originalWorkspace
		homeDirOverridden = originalOverride
	})
	systemHomeDir, HomeDir = t.TempDir(), t.TempDir()
	homeDirOverridden = true
	for _, test := range []struct {
		name, relative string
		sensitive      bool
	}{
		{"system config", filepath.Join(".config", "SiYuan"), true},
		{"system ssh", filepath.Join(".ssh", "example"), true},
		{"ordinary workspace", filepath.Join("notebooks", "SiYuan"), false},
	} {
		t.Run(test.name, func(t *testing.T) {
			realWorkspace := filepath.Join(systemHomeDir, test.relative)
			if err := os.MkdirAll(realWorkspace, 0755); err != nil {
				t.Fatal(err)
			}
			WorkspaceDir = filepath.Join(HomeDir, test.name)
			if err := os.Symlink(realWorkspace, WorkspaceDir); err != nil {
				t.Skipf("create workspace symlink: %v", err)
			}
			// 只构造无敏感内容的临时路径，同时覆盖尚未创建的目标。
			for _, root := range []string{WorkspaceDir, realWorkspace} {
				path := filepath.Join(root, "example.txt")
				if got := IsSensitivePath(path); got != test.sensitive {
					t.Errorf("IsSensitivePath(%q)=%v, want %v", path, got, test.sensitive)
				}
			}
		})
	}
}

func TestMatchSystemICloudRootWithHomeDirOverride(t *testing.T) {
	originalHome, originalSystem, originalOverride := HomeDir, systemHomeDir, homeDirOverridden
	t.Cleanup(func() {
		HomeDir, systemHomeDir, homeDirOverridden = originalHome, originalSystem, originalOverride
	})
	systemHomeDir = t.TempDir()
	configuredHome := t.TempDir()
	for _, home := range []string{systemHomeDir, configuredHome} {
		if err := os.MkdirAll(filepath.Join(home, "Library", "Mobile Documents"), 0755); err != nil {
			t.Fatal(err)
		}
	}
	if err := SetHomeDir(configuredHome); err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct {
		home string
		want bool
	}{
		{systemHomeDir, true},
		{configuredHome, false},
	} {
		workspace := filepath.Join(test.home, "Library", "Mobile Documents", "SiYuan")
		if _, matched := matchSystemICloudRoot(workspace); matched != test.want {
			t.Errorf("iCloud detection for %q=%v, want %v", workspace, matched, test.want)
		}
	}
}

func TestIsSensitivePathHomeDirOverrideHomeAlias(t *testing.T) {
	originalHome, originalSystem, originalWorkspace := HomeDir, systemHomeDir, WorkspaceDir
	originalOverride := homeDirOverridden
	t.Cleanup(func() {
		HomeDir, systemHomeDir, WorkspaceDir = originalHome, originalSystem, originalWorkspace
		homeDirOverridden = originalOverride
	})
	realHome := t.TempDir()
	realWorkspace := filepath.Join(realHome, ".config", "SiYuan")
	if err := os.MkdirAll(realWorkspace, 0755); err != nil {
		t.Fatal(err)
	}
	HomeDir = filepath.Join(t.TempDir(), "profile-link")
	if err := os.Symlink(realHome, HomeDir); err != nil {
		t.Skipf("create profile symlink: %v", err)
	}
	if err := os.Symlink(realWorkspace, filepath.Join(realHome, "workspace")); err != nil {
		t.Skipf("create workspace symlink: %v", err)
	}
	systemHomeDir = t.TempDir()
	homeDirOverridden = true
	WorkspaceDir = filepath.Join(HomeDir, "workspace")
	if err := os.WriteFile(filepath.Join(realWorkspace, "existing.txt"), []byte("fixture"), 0600); err != nil {
		t.Fatal(err)
	}
	for _, root := range []string{WorkspaceDir, filepath.Join(realHome, "workspace"), realWorkspace} {
		for _, relative := range []string{"existing.txt", "example.txt", filepath.Join("missing", "example.txt")} {
			if path := filepath.Join(root, relative); !IsSensitivePath(path) {
				t.Errorf("configured home credential alias is no longer protected: %s", path)
			}
		}
	}
}
