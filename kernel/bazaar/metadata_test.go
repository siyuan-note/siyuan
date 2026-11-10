// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package bazaar

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestBuildBazaarPackageCreatedFromStage(t *testing.T) {
	for _, test := range []struct {
		name, field, want string
	}{
		{"first listed", `,"created":"2026-11-01T12:34:56Z"`, "2026-11-01T12:34:56Z"},
		{"missing", "", ""},
		{"empty", `,"created":""`, ""},
		{"null", `,"created":null`, ""},
		{"unrecognized format", `,"created":"unknown"`, "unknown"},
	} {
		t.Run(test.name, func(t *testing.T) {
			var stage StageIndex
			data := `{"repos":[{"url":"owner/repo@hash","updated":"2026-11-07T10:00:00Z"` + test.field +
				`,"package":{"name":"sample","created":"manifest-created"}}]}`
			if err := json.Unmarshal([]byte(data), &stage); err != nil {
				t.Fatal(err)
			}
			for _, pkgType := range []string{"plugins", "themes", "widgets", "icons", "templates"} {
				packages := buildBazaarPackages(&stage, nil, nil, false, pkgType, "desktop")
				if len(packages) != 1 {
					t.Fatalf("%s: expected one package, got %d", pkgType, len(packages))
				}
				pkg := packages[0]
				if pkg.Created != test.want || pkg.Updated != stage.Repos[0].Updated {
					t.Fatalf("%s: unexpected created=%q updated=%q", pkgType, pkg.Created, pkg.Updated)
				}
				encoded, err := json.Marshal(pkg)
				if err != nil {
					t.Fatal(err)
				}
				var fields map[string]json.RawMessage
				if err = json.Unmarshal(encoded, &fields); err != nil {
					t.Fatal(err)
				}
				if _, exists := fields["created"]; exists != (test.want != "") {
					t.Fatalf("%s: created presence does not preserve unknown state: %s", pkgType, encoded)
				}
			}
			if stage.Repos[0].Package.Created != "manifest-created" {
				t.Fatal("building package metadata mutated the cached manifest")
			}
		})
	}
}

func TestBuildBazaarPackageIndependentCompatibility(t *testing.T) {
	for _, pkgType := range []string{"plugins", "themes"} {
		for _, test := range []struct {
			name               string
			minAppVersion      string
			frontends          []string
			backends           []string
			versionUnsupported bool
			incompatible       bool
		}{
			{name: "supported", minAppVersion: util.Ver, frontends: []string{"desktop"}},
			{name: "version only", minAppVersion: "99999.0.0", frontends: []string{"desktop"}, versionUnsupported: true},
			{name: "frontend only", minAppVersion: "0.0.0", frontends: []string{"mobile"}, incompatible: true},
			{name: "version and frontend", minAppVersion: "99999.0.0", frontends: []string{"mobile"}, versionUnsupported: true, incompatible: true},
			{name: "backend only", minAppVersion: "0.0.0", frontends: []string{"desktop"}, backends: []string{"unsupported-backend"}, incompatible: pkgType == "plugins"},
			{name: "version and backend", minAppVersion: "99999.0.0", frontends: []string{"desktop"}, backends: []string{"unsupported-backend"}, versionUnsupported: true, incompatible: pkgType == "plugins"},
			{name: "missing requirements"},
		} {
			t.Run(pkgType+"/"+test.name, func(t *testing.T) {
				pkg := buildBazaarPackageWithMetadata(&StageRepo{
					URL: "owner/repo@hash",
					Package: &Package{Name: "sample", MinAppVersion: test.minAppVersion,
						Frontends: test.frontends, Backends: test.backends, BazaarVersionUnsupported: true},
				}, nil, nil, false, pkgType, "desktop")
				if pkg == nil || pkg.BazaarIncompatible == nil {
					t.Fatal("missing package compatibility metadata")
				}
				if pkg.BazaarVersionUnsupported != test.versionUnsupported || *pkg.BazaarIncompatible != test.incompatible {
					t.Fatalf("unexpected versionUnsupported=%v incompatible=%v", pkg.BazaarVersionUnsupported, *pkg.BazaarIncompatible)
				}
				wantDisallow := test.versionUnsupported || test.incompatible
				if pkg.DisallowInstall != wantDisallow || pkg.DisallowUpdate != wantDisallow || pkg.UpdateRequiredMinAppVer != test.minAppVersion {
					t.Fatalf("install/update compatibility changed: %#v", pkg)
				}
			})
		}
	}
	for _, pkgType := range []string{"widgets", "icons", "templates"} {
		t.Run(pkgType, func(t *testing.T) {
			pkg := buildBazaarPackageWithMetadata(&StageRepo{
				URL: "owner/repo@hash", Package: &Package{Name: "sample", MinAppVersion: "99999.0.0"},
			}, nil, nil, false, pkgType, "desktop")
			if pkg == nil || !pkg.BazaarVersionUnsupported || !pkg.DisallowInstall || !pkg.DisallowUpdate || pkg.BazaarIncompatible != nil {
				t.Fatalf("unexpected version-only package compatibility: %#v", pkg)
			}
		})
	}
}

func TestParsePackageJSONClearsOnlineListingMetadata(t *testing.T) {
	manifest := filepath.Join(t.TempDir(), "plugin.json")
	if err := os.WriteFile(manifest, []byte(`{"name":"sample","created":"2026-11-01T12:34:56Z","bazaarVersionUnsupported":true,"minAppVersion":"3.6.1"}`), 0644); err != nil {
		t.Fatal(err)
	}
	pkg, err := ParsePackageJSON(manifest)
	if err != nil {
		t.Fatal(err)
	}
	if pkg.Created != "" || pkg.BazaarVersionUnsupported || pkg.MinAppVersion != "3.6.1" {
		t.Fatalf("unexpected local package metadata: %#v", pkg)
	}
}
