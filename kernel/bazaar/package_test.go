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

package bazaar

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestGetPreferredFunding(t *testing.T) {
	tests := []struct {
		name    string
		funding *Funding
		want    string
	}{
		{name: "missing funding"},
		{
			name: "platform priority",
			funding: &Funding{
				OpenCollective: "collective",
				Patreon:        "patron",
				GitHub:         "sponsor",
				Custom:         []string{"https://example.com"},
			},
			want: "https://opencollective.com/collective",
		},
		{
			name:    "complete platform URL",
			funding: &Funding{GitHub: "https://example.com/sponsor"},
			want:    "https://example.com/sponsor",
		},
		{
			name:    "custom text",
			funding: &Funding{Custom: []string{"支付宝：example"}},
			want:    "支付宝：example",
		},
		{
			name:    "custom mail address",
			funding: &Funding{Custom: []string{"mailto:sponsor@example.com"}},
			want:    "mailto:sponsor@example.com",
		},
		{
			name:    "skip invalid custom entries",
			funding: &Funding{Custom: []string{"", "javascript:alert(1)", "ftp://example.com", "https://example.com"}},
			want:    "https://example.com",
		},
		{
			name:    "plain text with colon",
			funding: &Funding{Custom: []string{"Note: scan the QR code"}},
			want:    "Note: scan the QR code",
		},
		{
			name: "legacy custom before labeled links",
			funding: &Funding{
				Custom: []string{"https://example.com/legacy"},
				Links:  []FundingLink{{Label: "Sponsor", URL: "https://example.com/labeled"}},
			},
			want: "https://example.com/legacy",
		},
		{
			name:    "labeled link fallback",
			funding: &Funding{Links: []FundingLink{{Label: "Sponsor", URL: "https://example.com/labeled"}}},
			want:    "https://example.com/labeled",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := getPreferredFunding(test.funding); got != test.want {
				t.Fatalf("expected %q, got %q", test.want, got)
			}
		})
	}
}

func TestPackageImageMetadataStates(t *testing.T) {
	var legacy Package
	if err := json.Unmarshal([]byte(`{"name":"legacy"}`), &legacy); err != nil {
		t.Fatal(err)
	}
	if legacy.Icon != nil || legacy.Preview != nil {
		t.Fatalf("missing image fields should remain nil: %#v", legacy)
	}

	var explicit Package
	if err := json.Unmarshal([]byte(`{"name":"explicit","icon":"","preview":"preview.avif"}`), &explicit); err != nil {
		t.Fatal(err)
	}
	if explicit.Icon == nil || *explicit.Icon != "" || explicit.Preview == nil || *explicit.Preview != "preview.avif" {
		t.Fatalf("explicit image fields lost their state: %#v", explicit)
	}
}

func TestBuildBazaarPackageImageURLs(t *testing.T) {
	empty := ""
	icon := "custom icon.webp"
	preview := "preview.avif"
	tests := []struct {
		name        string
		icon        *string
		preview     *string
		wantIcon    string
		wantPreview string
	}{
		{name: "legacy defaults", wantIcon: "/icon.png", wantPreview: "/preview.png?imageslim"},
		{name: "explicit missing", icon: &empty, preview: &empty},
		{name: "declared formats", icon: &icon, preview: &preview, wantIcon: "/custom%20icon.webp", wantPreview: "/preview.avif"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			pkg := buildBazaarPackageWithMetadata(&StageRepo{
				URL:     "owner/repo@hash",
				RepoRef: "v1.0.0",
				Package: &Package{Name: "sample", Icon: test.icon, Preview: test.preview},
			}, nil, nil, false, "widgets", "")
			if pkg == nil {
				t.Fatal("expected package")
			}
			if test.wantIcon == "" && test.wantPreview == "" {
				if pkg.IconURL != "" || pkg.PreviewURL != "" {
					t.Fatalf("explicit missing images should produce empty URLs: icon=%q preview=%q", pkg.IconURL,
						pkg.PreviewURL)
				}
				return
			}
			if !strings.HasSuffix(pkg.IconURL, test.wantIcon) || !strings.HasSuffix(pkg.PreviewURL, test.wantPreview) {
				t.Fatalf("unexpected image URLs: icon=%q preview=%q", pkg.IconURL, pkg.PreviewURL)
			}
			if pkg.RepoRef != "v1.0.0" {
				t.Fatalf("unexpected package source metadata: %#v", pkg)
			}
		})
	}
}

func TestOnlinePackagePreviewURLCompression(t *testing.T) {
	if got := onlinePackagePreviewURL("owner/repo@hash", "../preview.jpg"); got != "" {
		t.Fatalf("unexpected invalid preview URL: %q", got)
	}
	for _, name := range []string{"preview.png", "preview.jpg", "preview.jpeg"} {
		if got := onlinePackagePreviewURL("owner/repo@hash", name); !strings.HasSuffix(got, "?imageslim") {
			t.Fatalf("expected compressed preview URL for %q: %q", name, got)
		}
	}
	for _, name := range []string{"preview.webp", "preview.avif"} {
		if got := onlinePackagePreviewURL("owner/repo@hash", name); strings.Contains(got, "imageslim") {
			t.Fatalf("unexpected compressed preview URL for %q: %q", name, got)
		}
	}
}

func TestPackageImageNamesRejectUnsupportedFiles(t *testing.T) {
	for _, name := range []string{"icon.svg", "../icon.png", "folder/icon.webp", `folder\\icon.webp`, "icon.png "} {
		if isSupportedPackageImageName(name) {
			t.Fatalf("unsupported package image name accepted: %q", name)
		}
	}
	for _, name := range []string{"icon.png", "icon.jpg", "icon.jpeg", "icon.webp", "icon.avif"} {
		if !isSupportedPackageImageName(name) {
			t.Fatalf("supported package image name rejected: %q", name)
		}
	}
}

func TestSetPreferredPackageDeprecationMetadata(t *testing.T) {
	oldLang := util.Lang
	util.Lang = "zh-CN"
	t.Cleanup(func() { util.Lang = oldLang })

	pkg := &Package{
		Name:       "old-package",
		Deprecated: true,
		DeprecatedReason: LocaleStrings{
			"default": "No longer maintained",
			"zh-CN":   "已停止维护",
		},
		Alternatives: []string{"new-package", "new-package", "old-package", "插件"},
	}
	setPreferredPackageDeprecationMetadata(pkg)
	if pkg.PreferredDeprecatedReason != "已停止维护" {
		t.Fatalf("unexpected preferred deprecated reason %q", pkg.PreferredDeprecatedReason)
	}
	if len(pkg.Alternatives) != 1 || pkg.Alternatives[0] != "new-package" {
		t.Fatalf("unexpected alternatives %#v", pkg.Alternatives)
	}

	pkg.Deprecated = false
	setPreferredPackageDeprecationMetadata(pkg)
	if pkg.Deprecated || pkg.DeprecatedReason != nil || pkg.Alternatives != nil || pkg.PreferredDeprecatedReason != "" {
		t.Fatalf("active package retained deprecation metadata: %#v", pkg)
	}
}

func TestBuildBazaarPackageWithDeprecationMetadata(t *testing.T) {
	oldLang := util.Lang
	util.Lang = "en"
	t.Cleanup(func() { util.Lang = oldLang })

	pkg := buildBazaarPackageWithMetadata(&StageRepo{
		URL: "owner/old-package@abcdef0",
		Package: &Package{
			Name:             "old-package",
			Deprecated:       true,
			DeprecatedReason: LocaleStrings{"default": "No longer maintained"},
			Alternatives:     []string{"new-package"},
		},
	}, map[string]*bazaarStats{}, map[string]*PackageRating{}, false, "widgets", "")
	if pkg == nil || !pkg.Deprecated || pkg.PreferredDeprecatedReason != "No longer maintained" {
		t.Fatalf("unexpected built package %#v", pkg)
	}
	if len(pkg.Alternatives) != 1 || pkg.Alternatives[0] != "new-package" {
		t.Fatalf("unexpected built alternatives %#v", pkg.Alternatives)
	}
}

func TestUnescapePackageDeprecatedReason(t *testing.T) {
	pkg := &Package{DeprecatedReason: LocaleStrings{"default": "Use &lt;new-package&gt;"}}
	unescapePackageDisplayStrings(pkg)
	if pkg.DeprecatedReason["default"] != "Use <new-package>" {
		t.Fatalf("unexpected unescaped reason %q", pkg.DeprecatedReason["default"])
	}
}

func TestParsePackageJSONClearsGeneratedDeprecationMetadata(t *testing.T) {
	filePath := filepath.Join(t.TempDir(), "plugin.json")
	data := []byte(`{"name":"local-package","deprecated":true,"deprecatedReason":{"default":"Untrusted"},"alternatives":["other-package"]}`)
	if err := os.WriteFile(filePath, data, 0644); err != nil {
		t.Fatal(err)
	}
	pkg, err := ParsePackageJSON(filePath)
	if err != nil {
		t.Fatal(err)
	}
	if pkg.Deprecated || pkg.DeprecatedReason != nil || pkg.Alternatives != nil || pkg.PreferredDeprecatedReason != "" {
		t.Fatalf("local manifest supplied generated deprecation metadata: %#v", pkg)
	}
}

func TestIsValidStageRepoURL(t *testing.T) {
	tests := []struct {
		name string
		url  string
		want bool
	}{
		{name: "valid sha1 hash", url: "88250/example@6286912c381ef3f83e455d06ba4d369c498238dc", want: true},
		{name: "valid short hash", url: "owner/repo@abcdef0", want: true},
		{name: "valid placeholder hash", url: "owner/repo@hash", want: true},
		{name: "empty url", url: "", want: false},
		{name: "missing hash", url: "owner/repo", want: false},
		{name: "empty hash", url: "owner/repo@", want: false},
		{name: "multiple at signs", url: "owner/repo@hash@extra", want: false},
		{name: "hash too long", url: "owner/repo@" + strings.Repeat("a", 65), want: false},
		{name: "quote in owner", url: `owner" onerror="alert(1)/repo@hash`, want: false},
		{name: "quote in hash", url: `owner/repo@ha"sh`, want: false},
		{name: "colon in hash", url: "owner/repo@javascript:alert(1)", want: false},
		{name: "slash in hash", url: "owner/repo@ha/sh", want: false},
		{name: "multiple path segments", url: "owner/sub/repo@hash", want: false},
		{name: "path traversal owner", url: "../repo@hash", want: false},
		{name: "empty owner", url: "/repo@hash", want: false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := isValidStageRepoURL(tt.url); got != tt.want {
				t.Errorf("isValidStageRepoURL(%q) = %v, want %v", tt.url, got, tt.want)
			}
		})
	}
}
