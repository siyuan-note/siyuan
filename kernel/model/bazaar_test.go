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

	"github.com/siyuan-note/siyuan/kernel/bazaar"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestIsValidPackageName(t *testing.T) {
	valid := []string{"plugin-sample", "plugin.sample_1", "plugin sample (v1) + beta!", "CON.123", strings.Repeat("a", 255)}
	for _, name := range valid {
		if !isValidPackageName(name) {
			t.Fatalf("expected package name %q to be valid", name)
		}
	}

	invalid := []string{"", strings.Repeat("a", 256), ".hidden", " leading-space", "trailing-space ",
		"trailing-period.", "plugin/sample", "plugin..sample", "插件", "CON", "com1", "LPT9"}
	for _, name := range invalid {
		if isValidPackageName(name) {
			t.Fatalf("expected package name %q to be invalid", name)
		}
	}
}

func TestIsBuiltInAppearancePackageIgnoresCase(t *testing.T) {
	if !isBuiltInTheme("Daylight") || !isBuiltInTheme("MIDNIGHT") || !isBuiltInIcon("Litheness") {
		t.Fatal("expected built-in appearance package names to be case-insensitive")
	}
}

func TestBuildUpdatedPackagesKeepsInstalledAndAvailableMetadataSeparate(t *testing.T) {
	installed := &bazaar.Package{
		Name:          "example",
		Version:       "1.0.0",
		URL:           "https://github.com/old-owner/example",
		RepoURL:       "https://github.com/old-owner/example",
		PreferredName: "Installed name",
		IconURL:       "/plugins/example/icon.png",
		Current:       true,
	}
	online := &bazaar.Package{
		Name:           "example",
		Version:        "2.0.0",
		RepoURL:        "https://github.com/new-owner/example",
		RepoHash:       "new-hash",
		PreferredName:  "Available name",
		IconURL:        "https://example.com/icon.png",
		DisallowUpdate: true,
	}

	updated := buildUpdatedPackages(
		[]*bazaar.Package{installed},
		map[string]*bazaar.Package{"example": online},
	)

	if len(updated) != 1 {
		t.Fatalf("expected one updated package, got %d", len(updated))
	}
	if updated[0].Installed != installed {
		t.Fatal("expected the installed package to remain unchanged")
	}
	if updated[0].Installed.RepoURL != "https://github.com/old-owner/example" {
		t.Fatalf("expected installed repo URL, got %q", updated[0].Installed.RepoURL)
	}
	if updated[0].Available == online {
		t.Fatal("expected a copy of the available package")
	}
	if updated[0].Available.RepoURL != "https://github.com/new-owner/example" ||
		updated[0].Available.RepoHash != "new-hash" {
		t.Fatalf("expected online download metadata, got %q@%q", updated[0].Available.RepoURL, updated[0].Available.RepoHash)
	}
	if !updated[0].Available.DisallowUpdate {
		t.Fatal("expected the available package update restriction to remain unchanged")
	}
	if !updated[0].Available.Installed || !updated[0].Available.Outdated || !updated[0].Available.Current {
		t.Fatal("expected available package state to describe an installed update")
	}
	if online.Installed || online.Outdated || online.Current {
		t.Fatal("expected the online package cache entry to remain unchanged")
	}
}

func TestBuildUpdatedPackagesIgnoresMissingAndCurrentPackages(t *testing.T) {
	installedPackages := []*bazaar.Package{
		{Name: "current", Version: "2.0.0"},
		{Name: "missing", Version: "1.0.0"},
		{Name: "invalid", Version: "1.0.0", InvalidReason: bazaar.PackageInvalidReasonNameMismatch},
	}
	bazaarPackagesMap := map[string]*bazaar.Package{
		"current": {Name: "current", Version: "2.0.0"},
		"invalid": {Name: "invalid", Version: "2.0.0"},
	}

	updated := buildUpdatedPackages(installedPackages, bazaarPackagesMap)
	if len(updated) != 0 {
		t.Fatalf("expected no updated packages, got %d", len(updated))
	}
}

func TestGetInstalledPackageInfosIncludesInvalidPackages(t *testing.T) {
	oldDataDir := util.DataDir
	util.DataDir = t.TempDir()
	t.Cleanup(func() { util.DataDir = oldDataDir })

	pluginsPath := filepath.Join(util.DataDir, "plugins")
	packages := map[string]string{
		"valid":        `{"name":"valid","version":"1.0.0"}`,
		"mismatch":     `{"name":"other","version":"1.0.0"}`,
		"invalid-json": `{`,
		"插件":           `{"name":"插件","version":"1.0.0"}`,
	}
	for name, manifest := range packages {
		dir := filepath.Join(pluginsPath, name)
		if err := os.MkdirAll(dir, 0755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, "plugin.json"), []byte(manifest), 0644); err != nil {
			t.Fatal(err)
		}
	}
	missingPath := filepath.Join(pluginsPath, "missing")
	if err := os.MkdirAll(missingPath, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(missingPath, "index.js"), nil, 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(pluginsPath, "empty", "i18n"), 0755); err != nil {
		t.Fatal(err)
	}

	infos, _, _, err := GetInstalledPackageInfos("plugins")
	if err != nil {
		t.Fatal(err)
	}
	got := map[string]string{}
	for _, info := range infos {
		got[info.Pkg.Name] = info.Pkg.InvalidReason
		if info.Pkg.Name != info.DirName {
			t.Fatalf("expected package name %q to use directory name %q", info.Pkg.Name, info.DirName)
		}
	}
	want := map[string]string{
		"valid":        "",
		"mismatch":     bazaar.PackageInvalidReasonNameMismatch,
		"invalid-json": bazaar.PackageInvalidReasonInvalidManifest,
		"missing":      bazaar.PackageInvalidReasonMissingManifest,
		"插件":           bazaar.PackageInvalidReasonInvalidManifest,
	}
	if len(got) != len(want) {
		t.Fatalf("expected %d packages, got %#v", len(want), got)
	}
	for name, reason := range want {
		if got[name] != reason {
			t.Fatalf("expected package %q reason %q, got %q", name, reason, got[name])
		}
	}
}

func TestGetInstalledPackageInfosKeepsPlainTemplateDirectories(t *testing.T) {
	oldDataDir := util.DataDir
	util.DataDir = t.TempDir()
	t.Cleanup(func() { util.DataDir = oldDataDir })

	templatesPath := filepath.Join(util.DataDir, "templates")
	if err := os.MkdirAll(filepath.Join(templatesPath, "plain"), 0755); err != nil {
		t.Fatal(err)
	}
	mismatchPath := filepath.Join(templatesPath, "mismatch")
	if err := os.MkdirAll(mismatchPath, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(mismatchPath, "template.json"), []byte(`{"name":"other"}`), 0644); err != nil {
		t.Fatal(err)
	}

	infos, _, _, err := GetInstalledPackageInfos("templates")
	if err != nil {
		t.Fatal(err)
	}
	if len(infos) != 1 || infos[0].Pkg.Name != "mismatch" ||
		infos[0].Pkg.InvalidReason != bazaar.PackageInvalidReasonNameMismatch {
		t.Fatalf("unexpected template package infos: %#v", infos)
	}
}

func TestGetPackageUninstallPathUsesInvalidPackageDirectory(t *testing.T) {
	oldDataDir := util.DataDir
	util.DataDir = t.TempDir()
	t.Cleanup(func() { util.DataDir = oldDataDir })

	pluginsPath := filepath.Join(util.DataDir, "plugins")
	for name, manifestName := range map[string]string{"actual": "other", "other": "other"} {
		dir := filepath.Join(pluginsPath, name)
		if err := os.MkdirAll(dir, 0755); err != nil {
			t.Fatal(err)
		}
		manifest := `{"name":"` + manifestName + `"}`
		if err := os.WriteFile(filepath.Join(dir, "plugin.json"), []byte(manifest), 0644); err != nil {
			t.Fatal(err)
		}
	}

	installPath, err := getPackageUninstallPath("plugins", "actual")
	if err != nil {
		t.Fatal(err)
	}
	if installPath != filepath.Join(pluginsPath, "actual") {
		t.Fatalf("expected invalid package directory, got %q", installPath)
	}
}

func TestFilterUpdatableBazaarPackages(t *testing.T) {
	allowed := &UpdatedPackage{Available: &bazaar.Package{Name: "allowed"}}
	blocked := &UpdatedPackage{Available: &bazaar.Package{Name: "blocked", DisallowUpdate: true}}

	updatable, unmetRequirementCount := filterUpdatableBazaarPackages([]*UpdatedPackage{allowed, blocked, &UpdatedPackage{}})
	if len(updatable) != 1 || updatable[0] != allowed {
		t.Fatalf("expected only the allowed package, got %#v", updatable)
	}
	if unmetRequirementCount != 2 {
		t.Fatalf("expected two packages that do not meet update requirements, got %d", unmetRequirementCount)
	}
}
