package model

import (
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestSharedInstallPackageMigrationPreservesLegacyFiles(t *testing.T) {
	dir := prepareInstallPackageTest(t)
	legacy := filepath.Join(util.TempDir, "install")
	if err := os.MkdirAll(legacy, 0700); err != nil {
		t.Fatal(err)
	}
	metadata := installPackageFixture(t, legacy, "99.0.0", conf.UpdateChannelStable, "win.exe")
	corrupt := installPackageFixture(t, legacy, "99.0.1", conf.UpdateChannelStable, "win.exe")
	if err := os.WriteFile(filepath.Join(legacy, corrupt.FileName), []byte("corrupt"), 0600); err != nil {
		t.Fatal(err)
	}
	untrusted := installPackageFixture(t, legacy, "99.0.2", conf.UpdateChannelStable, "win.exe")
	if err := saveInstallPackageMetadata(legacy, untrusted, "different-key"); err != nil {
		t.Fatal(err)
	}
	if err := migrateLegacyInstallPackages(legacy, dir, installPackageTestKey); err != nil {
		t.Fatal(err)
	}
	assertInstallPackagePresent(t, dir, metadata)
	assertInstallPackagePresent(t, legacy, metadata)
	for _, rejected := range []*installPackageMetadata{corrupt, untrusted} {
		if _, err := os.Stat(filepath.Join(dir, rejected.FileName)); !os.IsNotExist(err) {
			t.Fatalf("invalid legacy package was migrated: %v", err)
		}
		if _, err := os.Stat(filepath.Join(legacy, rejected.FileName)); err != nil {
			t.Fatalf("invalid legacy source was removed: %v", err)
		}
	}
	// 中断后重试不替换完整的共享包，工作空间原件仍保留。
	if err := migrateLegacyInstallPackages(legacy, dir, installPackageTestKey); err != nil {
		t.Fatal(err)
	}
	assertInstallPackagePresent(t, dir, metadata)
}

func TestSharedInstallPackageDirectoryLink(t *testing.T) {
	dir := prepareInstallPackageTest(t)
	link := filepath.Join(util.TempDir, "install-shared")
	if err := createInstallPackageDirectoryLink(dir, link); err != nil {
		t.Fatal(err)
	}
	linked, err := os.Stat(link)
	if err != nil {
		t.Fatal(err)
	}
	target, err := os.Stat(dir)
	if err != nil || !os.SameFile(linked, target) {
		t.Fatalf("directory link does not point to the shared directory: %v", err)
	}
	metadata := installPackageFixture(t, dir, "99.0.0", conf.UpdateChannelStable, "win.exe")
	if data, err := os.ReadFile(filepath.Join(link, metadata.FileName)); err != nil || string(data) != "complete package" {
		t.Fatalf("workspace link does not expose the shared package: %v", err)
	}
	if err := createInstallPackageDirectoryLink(dir, link); err == nil {
		t.Fatal("existing link was overwritten")
	}
	if err := os.Remove(link); err != nil {
		t.Fatal(err)
	}
	assertInstallPackagePresent(t, dir, metadata)
}

func TestSharedInstallPackageMigrationFailureCanBeRetried(t *testing.T) {
	dir := prepareInstallPackageTest(t)
	legacy := filepath.Join(util.TempDir, "install")
	if err := os.MkdirAll(legacy, 0700); err != nil {
		t.Fatal(err)
	}
	metadata := installPackageFixture(t, legacy, "99.0.0", conf.UpdateChannelStable, "win.exe")
	blocked := filepath.Join(dir, metadata.FileName)
	if err := os.Mkdir(blocked, 0700); err != nil {
		t.Fatal(err)
	}
	if err := migrateLegacyInstallPackages(legacy, dir, installPackageTestKey); err == nil {
		t.Fatal("migration ignored a conflicting destination")
	}
	assertInstallPackagePresent(t, legacy, metadata)
	if partial, err := filepath.Glob(filepath.Join(dir, "*.part")); err != nil || len(partial) != 0 {
		t.Fatalf("failed migration left incomplete files: %v, %v", partial, err)
	}
	if err := os.Remove(blocked); err != nil {
		t.Fatal(err)
	}
	if err := migrateLegacyInstallPackages(legacy, dir, installPackageTestKey); err != nil {
		t.Fatal(err)
	}
	assertInstallPackagePresent(t, dir, metadata)
}

func TestSharedInstallPackageReusesUnsignedLegacyDownload(t *testing.T) {
	dir := prepareInstallPackageTest(t)
	legacy := filepath.Join(util.TempDir, "install")
	if err := os.MkdirAll(legacy, 0700); err != nil {
		t.Fatal(err)
	}
	metadata := installPackageFixture(t, legacy, "99.0.0", conf.UpdateChannelStable, "win.exe")
	if err := os.Remove(filepath.Join(legacy, metadata.FileName+".json")); err != nil {
		t.Fatal(err)
	}
	// 线上校验值匹配时无需访问下载地址，即可认证并复用没有记录的历史安装包。
	if err := downloadInstallPkg("http://127.0.0.1:0", metadata); err != nil {
		t.Fatal(err)
	}
	assertInstallPackagePresent(t, dir, metadata)
	if _, err := os.Stat(filepath.Join(legacy, metadata.FileName)); err != nil {
		t.Fatalf("legacy source was removed: %v", err)
	}
}

func TestSharedInstallPackageReservationSurvivesKernelExit(t *testing.T) {
	dir := prepareInstallPackageTest(t)
	metadata := installPackageFixture(t, dir, "99.0.0", conf.UpdateChannelStable, "win.exe")
	path := filepath.Join(dir, metadata.FileName)
	if got := selectTestInstallPackage(t, dir, true); got != path {
		t.Fatalf("final selection returned %q", got)
	}
	installPackageFiles.preservedPath = ""
	other := exec.Command(os.Args[0], "-test.run=^TestSharedInstallPackageProcessHelper$", "-test.timeout=15s")
	other.Env = append(os.Environ(), "SIYUAN_TEST_INSTALL_MODE=cleanup", "SIYUAN_TEST_INSTALL_HOME="+util.HomeDir,
		"SIYUAN_TEST_INSTALL_TEMP="+t.TempDir())
	if output, err := other.CombinedOutput(); err != nil {
		t.Fatalf("another workspace cleanup failed: %v, %s", err, output)
	}
	assertInstallPackagePresent(t, dir, metadata)
	replacement := *metadata
	replacement.Checksum = fmt.Sprintf("%x", sha256.Sum256([]byte("replacement")))
	if _, err := reuseInstallPackage(dir, &replacement, installPackageTestKey); !errors.Is(err, errInstallPackagePreserved) {
		t.Fatalf("another workspace could replace the handed-off package: %v", err)
	}
	old := time.Now().Add(-25 * time.Hour)
	if err := os.Chtimes(path+".preserve", old, old); err != nil {
		t.Fatal(err)
	}
	clearInstallPackagesBefore(dir, "v98.0.0", "v99.0.1", "")
	for _, suffix := range []string{"", ".json", ".preserve"} {
		if _, err := os.Stat(path + suffix); !os.IsNotExist(err) {
			t.Fatalf("expired handoff was not cleaned: %s, %v", suffix, err)
		}
	}
}

func TestSharedInstallPackageCleanupPreservesOtherChannels(t *testing.T) {
	dir := prepareInstallPackageTest(t)
	stable := installPackageFixture(t, dir, "99.0.0", conf.UpdateChannelStable, "win.exe")
	beta := installPackageFixture(t, dir, "99.1.0-beta.1", conf.UpdateChannelBeta, "win.exe")
	alpha := installPackageFixture(t, dir, "99.2.0-alpha.1", conf.UpdateChannelAlpha, "win.exe")
	old := installPackageFixture(t, dir, "1.0.0", conf.UpdateChannelStable, "win.exe")
	clearOldInstallPackagesLocked("v99.2.0-alpha.1", filepath.Join(dir, alpha.FileName))
	for _, metadata := range []*installPackageMetadata{stable, beta, alpha} {
		assertInstallPackagePresent(t, dir, metadata)
	}
	if got := findReadyInstallPackage(dir, "98.0.0", conf.UpdateChannelStable, "win.exe", installPackageTestKey); got != filepath.Join(dir, stable.FileName) {
		t.Fatalf("alpha download removed the stable channel package: %s", got)
	}
	if _, err := os.Stat(filepath.Join(dir, old.FileName)); !os.IsNotExist(err) {
		t.Fatalf("obsolete shared package was not removed: %v", err)
	}
}

func TestSharedInstallPackageFailedHandoffCanRepairAfterRestart(t *testing.T) {
	for _, damage := range []string{"corrupt-package", "missing-package", "corrupt-record", "missing-record"} {
		t.Run(damage, func(t *testing.T) {
			dir := prepareInstallPackageTest(t)
			metadata := installPackageFixture(t, dir, "99.0.0", conf.UpdateChannelStable, "win.exe")
			path := filepath.Join(dir, metadata.FileName)
			if got := selectTestInstallPackage(t, dir, true); got != path {
				t.Fatalf("initial final selection returned %q", got)
			}
			installPackageFiles.preservedPath = ""
			var err error
			switch damage {
			case "corrupt-package":
				err = os.WriteFile(path, []byte("corrupt"), 0600)
			case "missing-package":
				err = os.Remove(path)
			case "corrupt-record":
				err = os.WriteFile(path+".json", []byte("{"), 0600)
			case "missing-record":
				err = os.Remove(path + ".json")
			}
			if err != nil {
				t.Fatal(err)
			}
			var requests atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				requests.Add(1)
				fmt.Fprint(w, "complete package")
			}))
			defer server.Close()
			if err = downloadInstallPkg(server.URL, metadata); err != nil {
				t.Fatalf("failed handoff prevented repair after restart: %v", err)
			}
			assertInstallPackagePresent(t, dir, metadata)
			wantRequests := int32(1)
			if damage == "corrupt-record" || damage == "missing-record" {
				wantRequests = 0
			}
			if requests.Load() != wantRequests {
				t.Fatalf("repair download count %d, want %d", requests.Load(), wantRequests)
			}
			if got := selectTestInstallPackage(t, dir, true); got != path {
				t.Fatalf("repaired package cannot be handed off: %s", got)
			}
		})
	}
}

// TestSharedInstallPackageProcessHelper 在独立进程中模拟另一工作空间的下载或清理。
func TestSharedInstallPackageProcessHelper(t *testing.T) {
	mode := os.Getenv("SIYUAN_TEST_INSTALL_MODE")
	if mode == "" {
		return
	}
	util.HomeDir, util.TempDir = os.Getenv("SIYUAN_TEST_INSTALL_HOME"), os.Getenv("SIYUAN_TEST_INSTALL_TEMP")
	Conf = NewAppConf()
	Conf.CookieKey = installPackageTestKey
	if mode == "cleanup" {
		lock, err := tryInstallPackageDownloadLock(sharedInstallPackageDir())
		if errors.Is(err, errInstallPackageDownloadBusy) {
			return
		}
		if err != nil {
			t.Fatal(err)
		}
		defer lock.Close()
		// 模拟已升级的另一进程，其清理范围包含正在交付或下载的旧版本。
		clearInstallPackagesBefore(sharedInstallPackageDir(), "v100.0.0", "v100.0.0", "")
		return
	}
	metadata := &installPackageMetadata{}
	if err := json.Unmarshal([]byte(os.Getenv("SIYUAN_TEST_INSTALL_METADATA")), metadata); err != nil {
		t.Fatal(err)
	}
	err := downloadInstallPkg(os.Getenv("SIYUAN_TEST_INSTALL_URL"), metadata)
	if mode == "busy" {
		if !errors.Is(err, errInstallPackageDownloadBusy) {
			t.Fatalf("concurrent download did not respect the shared lock: %v", err)
		}
	} else if err != nil {
		t.Fatal(err)
	}
}

func TestSharedInstallPackageDownloadAcrossWorkspaces(t *testing.T) {
	dir := prepareInstallPackageTest(t)
	content := "complete package"
	metadata := &installPackageMetadata{FormatVersion: installPackageMetadataVersion,
		Version: "99.0.0", Channel: conf.UpdateChannelStable, FileName: "siyuan-99.0.0-win.exe",
		Checksum: fmt.Sprintf("%x", sha256.Sum256([]byte(content)))}
	encoded, err := json.Marshal(metadata)
	if err != nil {
		t.Fatal(err)
	}
	started, resume := make(chan struct{}), make(chan struct{})
	var requests atomic.Int32
	var resumeOnce sync.Once
	release := func() { resumeOnce.Do(func() { close(resume) }) }
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if requests.Add(1) == 1 {
			close(started)
		}
		<-resume
		fmt.Fprint(w, content)
	}))
	t.Cleanup(server.Close)
	t.Cleanup(release)
	command := func(mode string) *exec.Cmd {
		cmd := exec.Command(os.Args[0], "-test.run=^TestSharedInstallPackageProcessHelper$", "-test.timeout=15s")
		cmd.Env = append(os.Environ(), "SIYUAN_TEST_INSTALL_MODE="+mode, "SIYUAN_TEST_INSTALL_HOME="+util.HomeDir,
			"SIYUAN_TEST_INSTALL_TEMP="+t.TempDir(), "SIYUAN_TEST_INSTALL_METADATA="+string(encoded),
			"SIYUAN_TEST_INSTALL_URL="+server.URL)
		return cmd
	}
	first := command("download")
	if err := first.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { release(); first.Wait() })
	select {
	case <-started:
	case <-time.After(10 * time.Second):
		t.Fatal("first workspace did not start downloading")
	}
	for _, mode := range []string{"busy", "cleanup"} {
		if output, err := command(mode).CombinedOutput(); err != nil {
			t.Fatalf("second workspace %s failed: %v, %s", mode, err, output)
		}
	}
	partial, err := filepath.Glob(filepath.Join(dir, metadata.FileName+".*.part"))
	if err != nil || len(partial) != 1 {
		t.Fatalf("another workspace removed the active download: %v, %v", partial, err)
	}
	release()
	if err := first.Wait(); err != nil {
		t.Fatal(err)
	}
	if output, err := command("download").CombinedOutput(); err != nil {
		t.Fatalf("second workspace failed to reuse the shared package: %v, %s", err, output)
	}
	if requests.Load() != 1 {
		t.Fatalf("workspaces downloaded the same package %d times", requests.Load())
	}
	assertInstallPackagePresent(t, dir, metadata)
}
