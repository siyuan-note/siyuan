package model

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
)

const installPackageTestKey = "install-package-test-key"

func installPackageFixture(t *testing.T, dir, version, channel, suffix string) *installPackageMetadata {
	t.Helper()
	metadata := &installPackageMetadata{
		FormatVersion: installPackageMetadataVersion,
		Version:       version, Channel: channel,
		FileName: "siyuan-" + version + "-" + suffix,
		Checksum: fmt.Sprintf("%x", sha256.Sum256([]byte("complete package"))),
	}
	if err := os.WriteFile(filepath.Join(dir, metadata.FileName), []byte("complete package"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := saveInstallPackageMetadata(dir, metadata, installPackageTestKey); err != nil {
		t.Fatal(err)
	}
	return metadata
}

func TestReadyInstallPackagePersistsAcrossRestartAndFiltersChannel(t *testing.T) {
	dir := t.TempDir()
	stable := installPackageFixture(t, dir, "3.8.6", conf.UpdateChannelStable, "win.exe")
	beta := installPackageFixture(t, dir, "3.8.7-beta.2", conf.UpdateChannelBeta, "win.exe")
	alpha := installPackageFixture(t, dir, "3.8.8-alpha.1", conf.UpdateChannelAlpha, "win.exe")
	installPackageFixture(t, dir, "4.0.0", conf.UpdateChannelStable, "mac.dmg")
	for channel, want := range map[string]*installPackageMetadata{
		conf.UpdateChannelStable: stable, conf.UpdateChannelBeta: beta, conf.UpdateChannelAlpha: alpha,
	} {
		if got := findReadyInstallPackage(dir, "3.8.5", channel, "win.exe", installPackageTestKey); got != filepath.Join(dir, want.FileName) {
			t.Fatalf("channel %s: got %q, want %s", channel, got, want.FileName)
		}
	}
	if got := findReadyInstallPackage(dir, "3.8.6", conf.UpdateChannelStable, "win.exe", installPackageTestKey); got != "" {
		t.Fatalf("current version offered as an update: %s", got)
	}
	if got := findReadyInstallPackage(dir, "5.0.0", conf.UpdateChannelAlpha, "win.exe", installPackageTestKey); got != "" {
		t.Fatalf("downgrade offered: %s", got)
	}
	// 校验记录绑定本机密钥，重启后可读取；密钥缺失或变化时拒绝自动安装。
	for _, key := range []string{"", "different-key"} {
		if got := findReadyInstallPackage(dir, "3.8.5", conf.UpdateChannelAlpha, "win.exe", key); got != "" {
			t.Fatalf("record accepted with an invalid key: %s", got)
		}
	}
}

func TestReadyInstallPackageRejectsTamperingAndPreservesFiles(t *testing.T) {
	for _, change := range []string{"package", "checksum", "version", "channel", "file name", "format", "signature", "truncated", "oversized", "missing"} {
		t.Run(change, func(t *testing.T) {
			dir := t.TempDir()
			metadata := installPackageFixture(t, dir, "3.8.6", conf.UpdateChannelStable, "win.exe")
			path := filepath.Join(dir, metadata.FileName)
			record := path + ".json"
			data, err := os.ReadFile(record)
			if err != nil {
				t.Fatal(err)
			}
			var stored installPackageMetadata
			if err = json.Unmarshal(data, &stored); err != nil {
				t.Fatal(err)
			}
			switch change {
			case "package":
				err = os.WriteFile(path, []byte("partial package"), 0600)
			case "checksum":
				err = os.WriteFile(path, []byte("modified package"), 0600)
				stored.Checksum = fmt.Sprintf("%x", sha256.Sum256([]byte("modified package")))
			case "version":
				stored.Version = "3.8.7"
			case "channel":
				stored.Channel = conf.UpdateChannelAlpha
			case "file name":
				stored.FileName = "../" + stored.FileName
			case "format":
				stored.FormatVersion = 99
			case "signature":
				stored.Signature = strings.Repeat("0", 64)
			case "truncated":
				data = data[:len(data)/2]
			case "oversized":
				data = append(data, []byte(strings.Repeat(" ", 16*1024))...)
			case "missing":
				err = os.Remove(record)
			}
			if err != nil {
				t.Fatal(err)
			}
			if change != "missing" {
				if change != "truncated" && change != "oversized" {
					data, err = json.Marshal(stored)
					if err != nil {
						t.Fatal(err)
					}
				}
				if err = os.WriteFile(record, data, 0600); err != nil {
					t.Fatal(err)
				}
			}
			before, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			if got := findReadyInstallPackage(dir, "3.8.5", conf.UpdateChannelStable, "win.exe", installPackageTestKey); got != "" {
				t.Fatalf("invalid install package was accepted: %s", got)
			}
			after, err := os.ReadFile(path)
			if err != nil || string(before) != string(after) {
				t.Fatal("invalid package was modified or removed")
			}
			if change != "missing" {
				afterRecord, err := os.ReadFile(record)
				if err != nil || string(afterRecord) != string(data) {
					t.Fatal("invalid record was modified or removed")
				}
			}
		})
	}
}

func prepareInstallPackageTest(t *testing.T) string {
	t.Helper()
	oldConf, oldTemp, oldSkip, oldExiting := Conf, util.TempDir, skipInstallPkgPlatformCached, util.IsExiting.Load()
	installPackageFiles.Lock()
	oldPreserved := installPackageFiles.preservedPath
	installPackageFiles.preservedPath = ""
	installPackageFiles.Unlock()
	Conf = NewAppConf()
	Conf.CookieKey = installPackageTestKey
	Conf.System.Store(conf.NewSystem())
	Conf.System.Load().DownloadInstallPkg = true
	Conf.System.Load().UpdateChannel = conf.UpdateChannelStable
	util.TempDir = t.TempDir()
	skipInstallPkgPlatformCached = 0
	util.IsExiting.Store(false)
	t.Cleanup(func() {
		Conf, util.TempDir, skipInstallPkgPlatformCached = oldConf, oldTemp, oldSkip
		util.IsExiting.Store(oldExiting)
		installPackageFiles.Lock()
		installPackageFiles.preservedPath = oldPreserved
		installPackageFiles.Unlock()
	})
	dir := filepath.Join(util.TempDir, "install")
	if err := os.MkdirAll(dir, 0700); err != nil {
		t.Fatal(err)
	}
	return dir
}

func TestExitInstallPackageCheckDoesNotWaitForDownload(t *testing.T) {
	if currentInstallPackageSuffix() == "" {
		t.Skip("automatic installation is desktop-only")
	}
	dir := prepareInstallPackageTest(t)
	var requests atomic.Int32
	proxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		http.Error(w, "unexpected update request", http.StatusBadGateway)
	}))
	defer proxy.Close()
	t.Setenv("HTTPS_PROXY", proxy.URL)
	t.Setenv("NO_PROXY", "")
	githubReleasesLock.Lock()
	oldReleases, oldCacheTime := cachedGitHubReleases, githubReleasesCacheTime
	cachedGitHubReleases, githubReleasesCacheTime = nil, 0
	githubReleasesLock.Unlock()
	t.Cleanup(func() {
		githubReleasesLock.Lock()
		cachedGitHubReleases, githubReleasesCacheTime = oldReleases, oldCacheTime
		githubReleasesLock.Unlock()
	})
	Conf.System.Load().UpdateChannel = conf.UpdateChannelAlpha
	metadata := installPackageFixture(t, dir, "99.0.0", conf.UpdateChannelStable, currentInstallPackageSuffix())
	checkDownloadInstallPkgLock.Lock()
	defer checkDownloadInstallPkgLock.Unlock()
	done := make(chan string, 1)
	go func() { done <- getNewVerInstallPkgPath(false) }()
	select {
	case path := <-done:
		if path != filepath.Join(dir, metadata.FileName) {
			t.Fatalf("ready package not found without release cache: %s", path)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("exit waited for the download or release request")
	}
	util.IsExiting.Store(true)
	cleaned := make(chan struct{})
	go func() { clearOldInstallPackages(""); close(cleaned) }()
	select {
	case <-cleaned:
	case <-time.After(2 * time.Second):
		t.Fatal("exit cleanup waited for the download lock")
	}
	if _, err := os.Stat(filepath.Join(dir, metadata.FileName)); err != nil {
		t.Fatal("exit cleanup removed the pending installation")
	}
	if err := os.Remove(filepath.Join(dir, metadata.FileName+".json")); err != nil {
		t.Fatal(err)
	}
	if got := getNewVerInstallPkgPath(false); got != "" {
		t.Fatalf("package without a trusted record became ready: %s", got)
	}
	if requests.Load() != 0 {
		t.Fatalf("exit made %d update requests", requests.Load())
	}
	Conf.System.Load().DownloadInstallPkg = false
	if got := getNewVerInstallPkgPath(false); got != "" {
		t.Fatalf("disabled automatic installation returned a package: %s", got)
	}
}

func TestReadyInstallPackageRejectsMissingAndNonRegularPackages(t *testing.T) {
	for _, change := range []string{"missing", "directory"} {
		t.Run(change, func(t *testing.T) {
			dir := t.TempDir()
			metadata := installPackageFixture(t, dir, "3.8.6", conf.UpdateChannelStable, "win.exe")
			path := filepath.Join(dir, metadata.FileName)
			if err := os.Remove(path); err != nil {
				t.Fatal(err)
			}
			if change == "directory" {
				if err := os.Mkdir(path, 0700); err != nil {
					t.Fatal(err)
				}
			}
			if got := findReadyInstallPackage(dir, "3.8.5", conf.UpdateChannelStable, "win.exe", installPackageTestKey); got != "" {
				t.Fatalf("non-regular or missing file became ready: %s", got)
			}
			if _, err := os.Stat(path + ".json"); err != nil {
				t.Fatal("record was removed while rejecting its package")
			}
		})
	}
}

func TestDownloadInstallPackageMigratesExistingAndAuthenticatesNewPackage(t *testing.T) {
	dir := prepareInstallPackageTest(t)
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		fmt.Fprint(w, "complete package")
	}))
	defer server.Close()
	metadata := installPackageFixture(t, dir, "99.0.0", conf.UpdateChannelStable, "win.exe")
	packagePath := filepath.Join(dir, metadata.FileName)
	if err := os.Remove(packagePath + ".json"); err != nil {
		t.Fatal(err)
	}
	// 已下载的旧安装包通过线上校验值验证后补齐记录，不重复下载。
	if err := downloadInstallPkg(server.URL+"/package", metadata); err != nil {
		t.Fatal(err)
	}
	if requests.Load() != 0 {
		t.Fatal("existing verified package was downloaded again")
	}
	if _, err := readInstallPackageMetadata(packagePath+".json", installPackageTestKey); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(packagePath); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(packagePath + ".json"); err != nil {
		t.Fatal(err)
	}
	if err := downloadInstallPkg(server.URL+"/package", metadata); err != nil {
		t.Fatal(err)
	}
	if requests.Load() != 1 {
		t.Fatalf("unexpected download count: %d", requests.Load())
	}
	if got := findReadyInstallPackage(dir, "98.0.0", conf.UpdateChannelStable, "win.exe", installPackageTestKey); got != packagePath {
		t.Fatalf("downloaded package not ready: %s", got)
	}
	metadata.Checksum = strings.Repeat("0", 64)
	if err := downloadInstallPkg(server.URL+"/package", metadata); err == nil {
		t.Fatal("checksum mismatch accepted")
	}
	if got := findReadyInstallPackage(dir, "98.0.0", conf.UpdateChannelStable, "win.exe", installPackageTestKey); got != packagePath {
		t.Fatalf("failed replacement removed the previously verified package: %s", got)
	}
	if err := os.Remove(packagePath); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(packagePath + ".json"); err != nil {
		t.Fatal(err)
	}
	if err := downloadInstallPkg(server.URL+"/package", metadata); err == nil {
		t.Fatal("new package checksum mismatch accepted")
	}
	if entries, err := os.ReadDir(dir); err != nil || len(entries) != 0 {
		t.Fatalf("failed new download left a package or metadata behind: %v, %v", entries, err)
	}
}

func TestDownloadInstallPackageRemainsUnreadableUntilComplete(t *testing.T) {
	if currentInstallPackageSuffix() == "" {
		t.Skip("automatic installation is desktop-only")
	}
	dir := prepareInstallPackageTest(t)
	Conf.System.Load().UpdateChannel = conf.UpdateChannelAlpha
	started, releaseDownload, done := make(chan struct{}), make(chan struct{}), make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Length", "16")
		fmt.Fprint(w, "complete ")
		w.(http.Flusher).Flush()
		close(started)
		<-releaseDownload
		fmt.Fprint(w, "package")
	}))
	defer server.Close()
	name := currentInstallPackageName("99.0.0-alpha.1")
	githubReleasesLock.Lock()
	oldReleases, oldCacheTime := cachedGitHubReleases, githubReleasesCacheTime
	cachedGitHubReleases = []*githubRelease{{TagName: "v99.0.0-alpha.1", Assets: []*githubReleaseAsset{{
		Name: name, State: "uploaded", BrowserDownloadURL: server.URL + "/" + name,
		Digest: "sha256:" + fmt.Sprintf("%x", sha256.Sum256([]byte("complete package"))),
	}}}}
	githubReleasesCacheTime = time.Now().Unix()
	githubReleasesLock.Unlock()
	t.Cleanup(func() {
		githubReleasesLock.Lock()
		cachedGitHubReleases, githubReleasesCacheTime = oldReleases, oldCacheTime
		githubReleasesLock.Unlock()
	})
	go func() { checkDownloadInstallPkg(false); close(done) }()
	defer func() { close(releaseDownload); <-done }()
	select {
	case <-started:
	case <-time.After(5 * time.Second):
		t.Fatal("download did not start")
	}
	if _, err := os.Stat(filepath.Join(dir, name+".json")); !os.IsNotExist(err) {
		t.Fatalf("unfinished download has a ready record: %v", err)
	}
	checked := make(chan string, 1)
	go func() { checked <- getNewVerInstallPkgPath(false) }()
	select {
	case path := <-checked:
		if path != "" {
			t.Fatalf("unfinished download became ready: %s", path)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("exit check waited for the active download")
	}
}

func TestInstallPackageCleanupPreservesAndRemovesMatchingMetadata(t *testing.T) {
	dir := t.TempDir()
	old := installPackageFixture(t, dir, "3.8.4", conf.UpdateChannelStable, "win.exe")
	current := installPackageFixture(t, dir, "3.8.5", conf.UpdateChannelStable, "win.exe")
	next := installPackageFixture(t, dir, "3.8.6", conf.UpdateChannelStable, "win.exe")
	clearInstallPackagesBefore(dir, "v3.8.5", "v3.8.6", filepath.Join(dir, old.FileName))
	for _, metadata := range []*installPackageMetadata{old, current, next} {
		if _, err := readInstallPackageMetadata(filepath.Join(dir, metadata.FileName+".json"), installPackageTestKey); err != nil {
			t.Fatal(err)
		}
	}
	clearInstallPackagesBefore(dir, "v3.8.5", "v3.8.6", "")
	for _, suffix := range []string{"", ".json"} {
		if _, err := os.Stat(filepath.Join(dir, old.FileName+suffix)); !os.IsNotExist(err) {
			t.Fatalf("superseded package or record remains: %v", err)
		}
	}
}
