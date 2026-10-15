package model

import (
	"crypto/sha256"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// blockedInstallPackageDownload 模拟持有下载锁并停留在网络读取中的后台任务。
func blockedInstallPackageDownload(t *testing.T, metadata *installPackageMetadata, content string, cleanup bool) (release func(), done <-chan error) {
	t.Helper()
	started, resume := make(chan struct{}), make(chan struct{})
	var resumeOnce sync.Once
	release = func() { resumeOnce.Do(func() { close(resume) }) }
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Length", fmt.Sprint(len(content)))
		fmt.Fprint(w, content[:1])
		w.(http.Flusher).Flush()
		close(started)
		<-resume
		fmt.Fprint(w, content[1:])
	}))
	result := make(chan error, 1)
	finished := make(chan struct{})
	go func() {
		checkDownloadInstallPkgLock.Lock()
		defer checkDownloadInstallPkgLock.Unlock()
		defer close(finished)
		err := downloadInstallPkg(server.URL, metadata)
		if err == nil && cleanup {
			path := filepath.Join(util.TempDir, "install", metadata.FileName)
			clearOldInstallPackagesLocked(installPackageVersion(metadata.FileName), path)
		}
		result <- err
	}()
	t.Cleanup(func() {
		release()
		<-finished
		server.Close()
	})
	select {
	case <-started:
	case err := <-result:
		t.Fatalf("download ended before its network read: %v", err)
	case <-time.After(5 * time.Second):
		t.Fatal("download did not reach its network read")
	}
	return release, result
}

func selectTestInstallPackage(t *testing.T, dir string, preserve bool) string {
	t.Helper()
	selected := make(chan string, 1)
	go func() {
		selected <- readyInstallPackagePath(dir, "98.0.0", conf.UpdateChannelStable, "win.exe", installPackageTestKey, preserve)
	}()
	select {
	case path := <-selected:
		return path
	case <-time.After(2 * time.Second):
		t.Fatal("ready package selection waited for a network download")
		return ""
	}
}

func assertInstallPackagePresent(t *testing.T, dir string, metadata *installPackageMetadata) {
	t.Helper()
	path := filepath.Join(dir, metadata.FileName)
	stored, err := readInstallPackageMetadata(path+".json", installPackageTestKey)
	if err != nil {
		t.Fatal(err)
	}
	if got := verifiedInstallPackagePath(dir, stored); got != path || stored.Checksum != metadata.Checksum {
		t.Fatalf("ready package or its metadata changed: got %q, want %q", got, path)
	}
}

func TestFinalExitInstallPackageSurvivesNewerDownloadCleanup(t *testing.T) {
	dir := prepareInstallPackageTest(t)
	older := installPackageFixture(t, dir, "99.0.0", conf.UpdateChannelStable, "win.exe")
	newer := *older
	newer.Version, newer.FileName = "99.0.1", "siyuan-99.0.1-win.exe"
	release, done := blockedInstallPackageDownload(t, &newer, "complete package", true)
	util.IsExiting.Store(true)
	clearOldInstallPackages("")
	partial, err := filepath.Glob(filepath.Join(dir, newer.FileName+".*.part"))
	if err != nil || len(partial) != 1 {
		t.Fatalf("exit cleanup removed an active temporary download: %v, %v", partial, err)
	}
	if got := selectTestInstallPackage(t, dir, true); got != filepath.Join(dir, older.FileName) {
		t.Fatalf("final exit selected %q instead of the ready older package", got)
	}
	release()
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	assertInstallPackagePresent(t, dir, older)
	assertInstallPackagePresent(t, dir, &newer)
	// 最终退出重试仍返回首次交付的包，不使已有响应失去保护。
	if got := selectTestInstallPackage(t, dir, true); got != filepath.Join(dir, older.FileName) {
		t.Fatalf("final exit retry changed its reserved package: %s", got)
	}
	clearOldInstallPackages("")
	assertInstallPackagePresent(t, dir, older)
}

func TestInstallPackagePreviewDoesNotLeakExitPreservation(t *testing.T) {
	dir := prepareInstallPackageTest(t)
	older := installPackageFixture(t, dir, "99.0.0", conf.UpdateChannelStable, "win.exe")
	newer := *older
	newer.Version, newer.FileName = "99.0.1", "siyuan-99.0.1-win.exe"
	release, done := blockedInstallPackageDownload(t, &newer, "complete package", true)
	// 提示后取消时 IsExiting 可能仍为 true，但不应永久保护提示中的包。
	util.IsExiting.Store(true)
	if got := selectTestInstallPackage(t, dir, false); got != filepath.Join(dir, older.FileName) {
		t.Fatalf("preview selected %q", got)
	}
	release()
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	for _, suffix := range []string{"", ".json"} {
		if _, err := os.Stat(filepath.Join(dir, older.FileName+suffix)); !os.IsNotExist(err) {
			t.Fatalf("preview leaked a preserved old package or record: %v", err)
		}
	}
	assertInstallPackagePresent(t, dir, &newer)
	if got := selectTestInstallPackage(t, dir, true); got != filepath.Join(dir, newer.FileName) {
		t.Fatalf("later final exit did not select the new package: %s", got)
	}
}

func TestFinalExitInstallPackageBlocksSameNameReplacement(t *testing.T) {
	dir := prepareInstallPackageTest(t)
	metadata := installPackageFixture(t, dir, "99.0.0", conf.UpdateChannelStable, "win.exe")
	replacement := *metadata
	content := "replacement package"
	replacement.Checksum = fmt.Sprintf("%x", sha256.Sum256([]byte(content)))
	release, done := blockedInstallPackageDownload(t, &replacement, content, false)
	// 下载还在进行时，原文件和认证记录必须保持完整，最终选择可以立即使用它。
	assertInstallPackagePresent(t, dir, metadata)
	if got := selectTestInstallPackage(t, dir, true); got != filepath.Join(dir, metadata.FileName) {
		t.Fatalf("same-name partial download replaced the ready package: %s", got)
	}
	release()
	if err := <-done; !errors.Is(err, errInstallPackagePreserved) {
		t.Fatalf("same-name publication did not respect the final selection: %v", err)
	}
	assertInstallPackagePresent(t, dir, metadata)
	entries, err := os.ReadDir(dir)
	if err != nil || len(entries) != 2 {
		t.Fatalf("temporary download was not removed: %v, %v", entries, err)
	}
	// 已保留同名包时，下一次下载也必须在访问网络前拒绝替换。
	if err := downloadInstallPkg("http://127.0.0.1:0", &replacement); !errors.Is(err, errInstallPackagePreserved) {
		t.Fatalf("reserved package replacement was retried: %v", err)
	}
	assertInstallPackagePresent(t, dir, metadata)
}

func TestInstallPackageCleanupBeforeFinalSelection(t *testing.T) {
	dir := prepareInstallPackageTest(t)
	older := installPackageFixture(t, dir, "99.0.0", conf.UpdateChannelStable, "win.exe")
	newer := installPackageFixture(t, dir, "99.0.1", conf.UpdateChannelStable, "win.exe")
	clearOldInstallPackagesLocked("v99.0.1", filepath.Join(dir, newer.FileName))
	if got := selectTestInstallPackage(t, dir, true); got != filepath.Join(dir, newer.FileName) {
		t.Fatalf("selection after completed cleanup returned %q", got)
	}
	if _, err := os.Stat(filepath.Join(dir, older.FileName)); !os.IsNotExist(err) {
		t.Fatalf("unselected old package was retained: %v", err)
	}
}

func TestFinalExitInstallPackageRetryRechecksEligibility(t *testing.T) {
	dir := prepareInstallPackageTest(t)
	metadata := installPackageFixture(t, dir, "99.0.0-beta.1", conf.UpdateChannelBeta, "win.exe")
	path := filepath.Join(dir, metadata.FileName)
	if got := readyInstallPackagePath(dir, "98.0.0", conf.UpdateChannelBeta, "win.exe", installPackageTestKey, true); got != path {
		t.Fatalf("initial final selection returned %q", got)
	}
	for _, args := range []struct{ currentVersion, channel, suffix, key string }{
		{"98.0.0", conf.UpdateChannelStable, "win.exe", installPackageTestKey},
		{"98.0.0", conf.UpdateChannelBeta, "mac.dmg", installPackageTestKey},
		{"99.0.0-beta.1", conf.UpdateChannelBeta, "win.exe", installPackageTestKey},
		{"100.0.0", conf.UpdateChannelBeta, "win.exe", installPackageTestKey},
		{"invalid", conf.UpdateChannelBeta, "win.exe", installPackageTestKey},
		{"98.0.0", "invalid", "win.exe", installPackageTestKey},
		{"98.0.0", conf.UpdateChannelBeta, "", installPackageTestKey},
		{"98.0.0", conf.UpdateChannelBeta, "win.exe", "different-key"},
	} {
		if got := readyInstallPackagePath(dir, args.currentVersion, args.channel, args.suffix, args.key, true); got != "" {
			t.Fatalf("retry bypassed current eligibility checks for %+v: %s", args, got)
		}
	}
	if got := readyInstallPackagePath(dir, "98.0.0", conf.UpdateChannelBeta, "win.exe", installPackageTestKey, true); got != path {
		t.Fatalf("rejected retry released the original preservation: %s", got)
	}
	if err := os.WriteFile(path, []byte("modified package"), 0600); err != nil {
		t.Fatal(err)
	}
	if got := readyInstallPackagePath(dir, "98.0.0", conf.UpdateChannelBeta, "win.exe", installPackageTestKey, true); got != "" {
		t.Fatalf("retry accepted a modified reserved package: %s", got)
	}
}

func TestInstallPackageCleanupRemovesOnlyKnownInterruptedDownloads(t *testing.T) {
	dir := prepareInstallPackageTest(t)
	orphans := []string{"siyuan-99.0.0-win.exe.123.part", "siyuan-99.0.0-mac-arm64.dmg.456.part"}
	unrelated := []string{"notes.part", "siyuan-99.0.0-win.exe.part", "siyuan-99.0.0-win.exe.custom.part", "siyuan-99.0.0-linux.AppImage.123.part"}
	for _, name := range append(append([]string{}, orphans...), unrelated...) {
		if err := os.WriteFile(filepath.Join(dir, name), []byte("partial"), 0600); err != nil {
			t.Fatal(err)
		}
	}
	directory := filepath.Join(dir, "siyuan-99.0.0-win.exe.789.part")
	if err := os.Mkdir(directory, 0700); err != nil {
		t.Fatal(err)
	}
	clearOldInstallPackages("")
	for _, name := range orphans {
		if _, err := os.Stat(filepath.Join(dir, name)); !os.IsNotExist(err) {
			t.Fatalf("interrupted temporary download was retained: %s, %v", name, err)
		}
	}
	for _, name := range append(unrelated, filepath.Base(directory)) {
		if _, err := os.Stat(filepath.Join(dir, name)); err != nil {
			t.Fatalf("cleanup removed an unrelated file or directory: %s, %v", name, err)
		}
	}
}

func TestInstallPackageSameNameReplacementBeforeFinalSelection(t *testing.T) {
	dir := prepareInstallPackageTest(t)
	metadata := installPackageFixture(t, dir, "99.0.0", conf.UpdateChannelStable, "win.exe")
	content := "replacement package"
	metadata.Checksum = fmt.Sprintf("%x", sha256.Sum256([]byte(content)))
	release, done := blockedInstallPackageDownload(t, metadata, content, false)
	release()
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	assertInstallPackagePresent(t, dir, metadata)
	if got := selectTestInstallPackage(t, dir, true); got != filepath.Join(dir, metadata.FileName) {
		t.Fatalf("completed replacement was not ready: %s", got)
	}
}

func TestFinalExitInstallPackageRetryRejectsSymlinkMetadata(t *testing.T) {
	dir := prepareInstallPackageTest(t)
	metadata := installPackageFixture(t, dir, "99.0.0", conf.UpdateChannelStable, "win.exe")
	path := filepath.Join(dir, metadata.FileName)
	if got := selectTestInstallPackage(t, dir, true); got != path {
		t.Fatalf("initial final selection returned %q", got)
	}
	record := path + ".json"
	if err := os.Rename(record, record+".original"); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(record+".original", record); err != nil {
		t.Skipf("symlinks are unavailable: %v", err)
	}
	if got := selectTestInstallPackage(t, dir, true); got != "" {
		t.Fatalf("retry accepted a symlink metadata record: %s", got)
	}
}
