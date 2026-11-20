// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestInstallPackageReleaseURL(t *testing.T) {
	prepareInstallPackageTest(t)
	Conf.Lang = "zh-CN"
	for _, version := range []string{"99.3.0", "99.3.1-beta.3", "99.3.1-rc.1", "99.3.1-alpha.2"} {
		t.Run(version, func(t *testing.T) {
			key := "v" + version
			t.Cleanup(func() { updateReleaseURLs.Delete(key) })
			for _, suffix := range []string{"win.exe", "win-arm64.exe", "mac.dmg", "mac-arm64.dmg"} {
				installer := filepath.Join(t.TempDir(), "siyuan-"+version+"-"+suffix)
				if got := GetInstallPackageReleaseURL(installer); got != githubReleaseURLPrefix+version {
					t.Fatalf("restart fallback: %q", got)
				}
			}
			announcement := "https://ld246.com/article/123?version=" + version
			rememberUpdateReleaseURL(&updateRelease{Version: version, ReleaseURL: announcement})
			want := githubReleaseURLPrefix + version
			if version == "99.3.0" {
				want = announcement
			}
			if got := GetInstallPackageReleaseURL("siyuan-" + version + "-win.exe"); got != want {
				t.Fatalf("cached announcement: %q", got)
			}
			if got := GetInstallPackageReleaseURL("siyuan-99.4.0-win.exe"); got != githubReleaseURLPrefix+"99.4.0" {
				t.Fatalf("another version reused the announcement: %q", got)
			}
		})
	}
	for _, installer := range []string{"", "installer", "siyuan-latest-win.exe", "siyuan-99.0.0.zip"} {
		if got := GetInstallPackageReleaseURL(installer); got != "" {
			t.Fatalf("invalid installer %q has announcement %q", installer, got)
		}
	}
	for _, unsafe := range []string{"javascript:alert(1)", "/relative", "https://", "https://bad host/"} {
		rememberUpdateReleaseURL(&updateRelease{Version: "99.5.0", ReleaseURL: unsafe})
		if got := GetInstallPackageReleaseURL("siyuan-99.5.0-win.exe"); got != githubReleaseURLPrefix+"99.5.0" {
			t.Fatalf("unsafe announcement: %q", got)
		}
	}
}

func TestInstallPackageMainlandAnnouncementSurvivesRestart(t *testing.T) {
	dir := prepareInstallPackageTest(t)
	oldRegion := util.CurrentCloudRegion
	t.Cleanup(func() { util.CurrentCloudRegion = oldRegion })
	const version = "99.8.0"
	const announcement = "https://ld246.com/article/123"
	metadata := installPackageFixture(t, dir, version, conf.UpdateChannelStable, "win.exe")
	result := map[string]any{"ver": version, "release_zh_CN": announcement}
	if got := getMainlandReleaseURL(result, "99.8.1"); got != "" {
		t.Fatalf("mismatched version reused an announcement: %q", got)
	}
	metadata.MainlandReleaseURL = getMainlandReleaseURL(result, version)
	installer, err := reuseInstallPackage(dir, metadata, Conf.CookieKey)
	if err != nil || installer == "" {
		t.Fatalf("reuse existing installer: %q, %v", installer, err)
	}
	for _, test := range []struct {
		lang   string
		region int
		want   string
	}{
		{"zh-CN", 0, announcement},
		{"zh-CN", 1, githubReleaseURLPrefix + version},
		{"en", 0, githubReleaseURLPrefix + version},
	} {
		Conf.Lang, util.CurrentCloudRegion = test.lang, test.region
		if got := GetInstallPackageReleaseURL(installer); got != test.want {
			t.Fatalf("locale %s, region %d: got %q, want %q", test.lang, test.region, got, test.want)
		}
	}
	record := installer + ".json"
	data, err := os.ReadFile(record)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(record, bytes.Replace(data, []byte(announcement), []byte("https://ld246.com/article/456"), 1), 0600); err != nil {
		t.Fatal(err)
	}
	Conf.Lang, util.CurrentCloudRegion = "zh-CN", 0
	if got := GetInstallPackageReleaseURL(installer); got != githubReleaseURLPrefix+version {
		t.Fatalf("tampered announcement was used: %q", got)
	}
	if _, err = readInstallPackageMetadata(record, Conf.CookieKey); err != nil {
		t.Fatalf("tampered announcement invalidated the installer record: %v", err)
	}
}

func TestInstallPackageUsesLocalizedReleaseAnnouncement(t *testing.T) {
	previousConf := Conf
	Conf = NewAppConf()
	t.Cleanup(func() {
		Conf = previousConf
		updateReleaseURLs.Delete("v99.7.0")
	})
	result := map[string]any{
		"release":        "https://example.invalid/default",
		"release_zh-CN":  "https://ld246.com/article/123",
		"release_en":     "https://liuyun.io/article/456",
		"release_zh_CHT": "https://liuyun.io/article/789",
	}
	for _, test := range []struct{ lang, want string }{
		{"zh-CN", "https://ld246.com/article/123"},
		{"en", "https://liuyun.io/article/456"},
		{"zh-TW", "https://liuyun.io/article/789"},
		{"ja", "https://example.invalid/default"},
	} {
		Conf.Lang = test.lang
		rememberUpdateReleaseURL(&updateRelease{Version: "99.7.0", ReleaseURL: getStableReleaseURL(result, "99.7.0")})
		if got := GetInstallPackageReleaseURL("siyuan-99.7.0-win.exe"); got != test.want {
			t.Fatalf("locale %q: got %q, want %q", test.lang, got, test.want)
		}
	}
}

func TestPrereleaseInstallerUsesGitHubAnnouncement(t *testing.T) {
	previousConf := Conf
	Conf = NewAppConf()
	t.Cleanup(func() { Conf = previousConf })
	system := conf.NewSystem()
	system.UpdateChannel = conf.UpdateChannelBeta
	Conf.System.Store(system)
	githubReleasesLock.Lock()
	previousReleases, previousTime := cachedGitHubReleases, githubReleasesCacheTime
	cachedGitHubReleases = []*githubRelease{{TagName: "v99.6.0-beta.3", HTMLURL: "https://example.invalid/announcement"}}
	githubReleasesCacheTime = time.Now().Unix()
	githubReleasesLock.Unlock()
	t.Cleanup(func() {
		githubReleasesLock.Lock()
		cachedGitHubReleases, githubReleasesCacheTime = previousReleases, previousTime
		githubReleasesLock.Unlock()
		updateReleaseURLs.Delete("v99.6.0-beta.3")
	})
	if _, err := getUpdateRelease(false); err != nil {
		t.Fatal(err)
	}
	if got := GetInstallPackageReleaseURL("siyuan-99.6.0-beta.3-win.exe"); got != githubReleaseURLPrefix+"99.6.0-beta.3" {
		t.Fatalf("unexpected prerelease announcement: %q", got)
	}
}
