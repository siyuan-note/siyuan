// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"path/filepath"
	"testing"
	"time"

	"github.com/siyuan-note/siyuan/kernel/conf"
)

func TestInstallPackageReleaseURL(t *testing.T) {
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
			if got := GetInstallPackageReleaseURL("siyuan-" + version + "-win.exe"); got != announcement {
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

func TestUpdateCheckRemembersPackageAnnouncement(t *testing.T) {
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
	if got := GetInstallPackageReleaseURL("siyuan-99.6.0-beta.3-win.exe"); got != "https://example.invalid/announcement" {
		t.Fatalf("check result was not retained: %q", got)
	}
}
