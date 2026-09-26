package model

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestInstallPackageVersion(t *testing.T) {
	for name, want := range map[string]string{
		"siyuan-3.8.5-win.exe":                "v3.8.5",
		"siyuan-3.8.5-alpha.10-win-arm64.exe": "v3.8.5-alpha.10",
		"siyuan-3.8.5-beta.2-mac.dmg":         "v3.8.5-beta.2",
		"siyuan-3.8.5-mac-arm64.dmg":          "v3.8.5",
		"siyuan-test-win.exe":                 "",
		"siyuan-3.8.5-linux.AppImage":         "",
		"siyuan-3.8.5-win.exe.part":           "",
		"other-3.8.5-win.exe":                 "",
	} {
		if got := installPackageVersion(name); got != want {
			t.Errorf("%s: got %q, want %q", name, got, want)
		}
	}
}

func TestClearOldInstallPackages(t *testing.T) {
	originalTempDir := util.TempDir
	t.Cleanup(func() { util.TempDir = originalTempDir })
	util.TempDir = t.TempDir()
	currentVersion := "v3.8.5-alpha.2"
	installDir := filepath.Join(util.TempDir, "install")
	if err := os.MkdirAll(installDir, 0755); err != nil {
		t.Fatal(err)
	}
	names := []string{
		"siyuan-3.8.4-win.exe", "siyuan-3.8.5-alpha.1-win.exe",
		"siyuan-3.8.5-alpha.2-win.exe", "siyuan-3.8.5-alpha.3-win.exe",
		"siyuan-3.8.5-alpha.10-win.exe", "siyuan-3.8.5-beta.1-mac-arm64.dmg",
		"siyuan-3.8.5-win.exe", "notes.txt",
	}
	for _, name := range names {
		if err := os.WriteFile(filepath.Join(installDir, name), []byte("package"), 0644); err != nil {
			t.Fatal(err)
		}
	}
	directory := filepath.Join(installDir, "siyuan-3.8.3-win.exe")
	if err := os.Mkdir(directory, 0755); err != nil {
		t.Fatal(err)
	}
	assertExists := func(name string, want bool) {
		t.Helper()
		_, err := os.Stat(filepath.Join(installDir, name))
		if want && err != nil || !want && !os.IsNotExist(err) {
			t.Fatalf("%s: want existence %v, err %v", name, want, err)
		}
	}
	// 启动清理保留当前版本、未来版本、未知文件及目录。
	clearInstallPackagesBefore(installDir, currentVersion, currentVersion, "")
	for i, name := range names {
		assertExists(name, i >= 2)
	}
	assertExists(filepath.Base(directory), true)
	// 下载较新版本后仅清理被替代的包，当前版本和指定包始终保留。
	clearInstallPackagesBefore(installDir, currentVersion, "v3.8.5-alpha.10", filepath.Join(installDir, names[3]))
	assertExists(names[3], true)
	clearInstallPackagesBefore(installDir, currentVersion, "v3.8.5-alpha.10", "")
	assertExists(names[3], false)
	for _, name := range names[4:] {
		assertExists(name, true)
	}
	assertExists(names[2], true)
	// 清理等待下载释放互斥锁。
	checkDownloadInstallPkgLock.Lock()
	done := make(chan struct{})
	go func() { clearOldInstallPackages(""); close(done) }()
	select {
	case <-done:
		checkDownloadInstallPkgLock.Unlock()
		t.Fatal("cleanup did not wait for download lock")
	case <-time.After(20 * time.Millisecond):
	}
	checkDownloadInstallPkgLock.Unlock()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("cleanup did not finish after download lock was released")
	}
}
