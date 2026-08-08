// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

package model

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/conf"
)

func TestIsReleaseAllowed(t *testing.T) {
	tests := []struct {
		channel string
		version string
		want    bool
	}{
		{conf.UpdateChannelStable, "v3.7.3", true},
		{conf.UpdateChannelStable, "v3.7.4-rc.1", false},
		{conf.UpdateChannelBeta, "v3.7.3", true},
		{conf.UpdateChannelBeta, "v3.7.4-alpha.1", false},
		{conf.UpdateChannelBeta, "v3.7.4-beta.1", true},
		{conf.UpdateChannelBeta, "v2.0.0-beta2", true},
		{conf.UpdateChannelBeta, "v3.7.4-rc.1", true},
		{conf.UpdateChannelBeta, "v1.2.0-rc3", true},
		{conf.UpdateChannelAlpha, "v3.7.4-alpha.1", true},
		{conf.UpdateChannelAlpha, "v0.5.6-alpha1", true},
		{conf.UpdateChannelAlpha, "v3.7.4-beta.1", true},
		{conf.UpdateChannelAlpha, "v3.7.4-rc.1", true},
		{conf.UpdateChannelAlpha, "v3.7.4-preview.1", false},
		{conf.UpdateChannelAlpha, "v3.7.4-alphabet.1", false},
		{conf.UpdateChannelAlpha, "invalid", false},
		{"invalid", "v3.7.3", false},
	}
	for _, test := range tests {
		if got := isReleaseAllowed(test.channel, test.version); got != test.want {
			t.Fatalf("channel [%s] version [%s]: got %t, want %t", test.channel, test.version, got, test.want)
		}
	}
}

func TestSelectGitHubRelease(t *testing.T) {
	releases := []*githubRelease{
		{TagName: "v3.7.4-beta.1"},
		{TagName: "v3.7.3"},
		{TagName: "v3.8.0-preview.1"},
		{TagName: "v3.7.4-rc.1"},
		{TagName: "v3.8.0-alpha.1"},
		{TagName: "v4.0.0", Draft: true},
	}

	beta := selectGitHubRelease(releases, conf.UpdateChannelBeta)
	if nil == beta || "v3.7.4-rc.1" != beta.TagName {
		t.Fatalf("unexpected Beta release: %#v", beta)
	}
	alpha := selectGitHubRelease(releases, conf.UpdateChannelAlpha)
	if nil == alpha || "v3.8.0-alpha.1" != alpha.TagName {
		t.Fatalf("unexpected Alpha release: %#v", alpha)
	}
}

func TestParseChecksumManifest(t *testing.T) {
	checksum := strings.Repeat("A", 64)
	manifest := checksum + " *nested\\siyuan-3.7.4-alpha.1-win.exe\n"
	got := parseChecksumManifest(manifest, "siyuan-3.7.4-alpha.1-win.exe")
	if strings.ToLower(checksum) != got {
		t.Fatalf("unexpected checksum: %q", got)
	}
	if "" != parseChecksumManifest(manifest, "siyuan-3.7.4-alpha.1-win-arm64.exe") {
		t.Fatal("unexpected checksum for missing package")
	}
}

func TestNormalizeSHA256(t *testing.T) {
	checksum := strings.Repeat("A", 64)
	if got := normalizeSHA256("sha256:" + checksum); strings.ToLower(checksum) != got {
		t.Fatalf("unexpected normalized checksum: %q", got)
	}
	if "" != normalizeSHA256(strings.Repeat("z", 64)) {
		t.Fatal("invalid checksum should be rejected")
	}
}

func TestSHA256Hash(t *testing.T) {
	filePath := filepath.Join(t.TempDir(), "package")
	if err := os.WriteFile(filePath, []byte("abc"), 0644); err != nil {
		t.Fatal(err)
	}
	got, err := sha256Hash(filePath)
	if err != nil {
		t.Fatal(err)
	}
	const want = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
	if want != got {
		t.Fatalf("unexpected checksum: %q", got)
	}
}
