// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

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
	"testing"
	"time"

	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestManualUpdateDownload(t *testing.T) {
	if currentInstallPackageSuffix() == "" {
		t.Skip("installation is desktop-only")
	}
	languageData, err := os.ReadFile(filepath.Join("..", "..", "app", "appearance", "langs", "en.json"))
	if err != nil {
		t.Fatal(err)
	}
	var language struct {
		Kernel map[int]string `json:"_kernel"`
	}
	if err = json.Unmarshal(languageData, &language); err != nil {
		t.Fatal(err)
	}
	for _, scenario := range []string{"ready", "local-busy", "local-busy-auto", "stale", "missing-checksum", "unsupported", "empty"} {
		t.Run(scenario, func(t *testing.T) {
			dir := prepareInstallPackageTest(t)
			autoDownload := scenario == "local-busy-auto"
			localBusy := strings.HasPrefix(scenario, "local-busy")
			Conf.System.Load().DownloadInstallPkg = autoDownload
			Conf.System.Load().UpdateChannel = conf.UpdateChannelAlpha
			Conf.Lang = "en"
			originalLangs := util.Langs
			util.Langs = map[string]map[int]string{"en": {
				9: "New version %s", 62: "Ready", 421: language.Kernel[421], 437: "Download this version",
			}}
			t.Cleanup(func() { util.Langs = originalLangs })
			version := "99.0.0-alpha.1"
			metadata := installPackageFixture(t, dir, version, conf.UpdateChannelAlpha, currentInstallPackageSuffix())
			asset := &githubReleaseAsset{Name: metadata.FileName, BrowserDownloadURL: "http://127.0.0.1:0/package",
				Digest: "sha256:" + fmt.Sprintf("%x", sha256.Sum256([]byte("complete package"))), State: "uploaded"}
			githubReleasesLock.Lock()
			previousReleases, previousTime := cachedGitHubReleases, githubReleasesCacheTime
			cachedGitHubReleases = []*githubRelease{{TagName: "v" + version, Assets: []*githubReleaseAsset{asset}}}
			githubReleasesCacheTime = time.Now().Unix()
			githubReleasesLock.Unlock()
			t.Cleanup(func() {
				githubReleasesLock.Lock()
				cachedGitHubReleases, githubReleasesCacheTime = previousReleases, previousTime
				githubReleasesLock.Unlock()
			})
			switch scenario {
			case "local-busy", "local-busy-auto":
				checkDownloadInstallPkgLock.Lock()
				t.Cleanup(checkDownloadInstallPkgLock.Unlock)
			case "stale":
				version = "98.0.0-alpha.1"
			case "missing-checksum":
				asset.Digest = ""
			case "unsupported":
				skipInstallPkgPlatformCached = 1
			case "empty":
				version = ""
			}
			read := installPackageNotifications(t)
			// 自动检查遵守自动下载设置和本进程占用状态，即使缓存中已有完整安装包。
			checkDownloadInstallPkg(false)
			if events := read(); len(events) != 0 {
				t.Fatalf("automatic download ran while disabled or busy: %+v", events)
			}
			err := DownloadUpdate(version)
			if scenario != "ready" && !localBusy {
				if err == nil {
					t.Fatal("invalid manual download was accepted")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			deadline := time.Now().Add(5 * time.Second)
			wantID := "update-pkg-ready"
			if localBusy {
				wantID = "update-pkg-downloading"
			}
			notified := false
			for !notified && time.Now().Before(deadline) {
				for _, event := range read() {
					if event.Cmd != "msg" || event.Data.ID != wantID {
						t.Fatalf("unexpected manual download notification: %+v", event)
					}
					if localBusy && event.Msg != "Update packages are being processed. Please try again later" {
						t.Fatalf("local package processing must not be attributed to another workspace: %q", event.Msg)
					}
					notified = true
				}
				if !notified {
					time.Sleep(time.Millisecond)
				}
			}
			if !notified {
				t.Fatalf("manual download did not report %s", wantID)
			}
			if Conf.System.Load().DownloadInstallPkg != autoDownload {
				t.Fatal("manual download changed the automatic download setting")
			}
			if localBusy {
				return
			}
			checkDownloadInstallPkgLock.Lock()
			checkDownloadInstallPkgLock.Unlock()
			if path := getNewVerInstallPkgPath(false); path != filepath.Join(dir, metadata.FileName) {
				t.Fatalf("manual package unavailable for installation with automatic download disabled: %q", path)
			}
		})
	}
}

func TestManualUpdateNotification(t *testing.T) {
	if currentInstallPackageSuffix() == "" {
		t.Skip("installation is desktop-only")
	}
	prepareInstallPackageTest(t)
	Conf.System.Load().DownloadInstallPkg = false
	Conf.Lang = "en"
	previousLangs := util.Langs
	util.Langs = map[string]map[int]string{"en": {9: "New version %s", 437: "Download this version"}}
	t.Cleanup(func() { util.Langs = previousLangs })
	read := installPackageNotifications(t)
	release := &updateRelease{Version: "99.0.0", Channel: conf.UpdateChannelStable,
		ReleaseURL: "https://github.com/siyuan-note/siyuan/releases/tag/v99.0.0",
		Packages: map[string]*updatePackage{currentInstallPackageName("99.0.0"): {
			URLs: []string{"http://127.0.0.1:0/package"}, Checksum: strings.Repeat("a", 64),
		}}}
	for _, available := range []bool{true, false} {
		if !available {
			release.Packages = nil
		}
		pushNewVersionNotification(release)
		events := read()
		if len(events) != 1 || strings.Contains(events[0].Msg, `data-type="download-update"`) != available {
			t.Fatalf("unexpected manual download action: %+v", events)
		}
		if available && !strings.Contains(events[0].Msg, `data-version="99.0.0"`) {
			t.Fatal("notification lost the selected version")
		}
		if available {
			if !strings.HasPrefix(events[0].Msg, `<div class="b3-snackbar__actions"><div class="b3-snackbar__body">New version <a `) ||
				!strings.Contains(events[0].Msg, `</div><button type="button" class="b3-button b3-button--white b3-button--wrap b3-snackbar__action"`) {
				t.Fatalf("notification must explicitly separate its body and download action: %s", events[0].Msg)
			}
		} else if strings.Contains(events[0].Msg, `b3-snackbar__actions`) {
			t.Fatal("notification without a download action has an empty action layout")
		}
	}
}

func TestManualUpdateDownloadsVerifiedBytesWithAutoDownloadDisabled(t *testing.T) {
	if currentInstallPackageSuffix() == "" {
		t.Skip("installation is desktop-only")
	}
	dir := prepareInstallPackageTest(t)
	Conf.System.Load().DownloadInstallPkg = false
	content := "manually requested installation package"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = fmt.Fprint(w, content)
	}))
	defer server.Close()
	pkg := &installPackageDownload{Metadata: installPackageMetadata{
		FormatVersion: installPackageMetadataVersion, Version: "99.0.0", Channel: conf.UpdateChannelStable,
		FileName: currentInstallPackageName("99.0.0"), Checksum: fmt.Sprintf("%x", sha256.Sum256([]byte(content))),
	}, URLs: []string{server.URL}}
	checkDownloadInstallPkgLock.Lock()
	installUpdatePackage(pkg)
	checkDownloadInstallPkgLock.Unlock()
	if got := getNewVerInstallPkgPath(false); got != filepath.Join(dir, pkg.Metadata.FileName) {
		t.Fatalf("downloaded package failed authenticated installation lookup: %q", got)
	}
	if Conf.System.Load().DownloadInstallPkg {
		t.Fatal("downloading changed the automatic download preference")
	}
}
