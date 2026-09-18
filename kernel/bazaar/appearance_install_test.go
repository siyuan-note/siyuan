package bazaar

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAppearanceInstallUsesOrdinaryMetadata(t *testing.T) {
	useTestBazaarInfo(t)
	for _, kind := range []string{"themes", "icons"} {
		t.Run(kind, func(t *testing.T) {
			manifest, entry := "theme.json", "theme.css"
			if kind == "icons" {
				manifest, entry = "icon.json", "icon.js"
			}
			source := t.TempDir()
			for name, data := range map[string]string{manifest: `{"name":"sample","version":"1.0.0"}`, entry: "first", "stale.txt": "stale"} {
				if err := os.WriteFile(filepath.Join(source, name), []byte(data), 0644); err != nil {
					t.Fatal(err)
				}
			}
			target := filepath.Join(util.DataDir, kind, "sample")
			if err := InstallLocalPackage(source, target, kind, "sample", false); err != nil {
				t.Fatal(err)
			}
			installed, updated := getPackageTimes(kind, "sample", target)
			if installed == 0 || updated != 0 {
				t.Fatalf("invalid install metadata: %d, %d", installed, updated)
			}
			if err := os.Remove(filepath.Join(source, "stale.txt")); err != nil {
				t.Fatal(err)
			}
			if err := InstallLocalPackage(source, target, kind, "sample", true); err != nil {
				t.Fatal(err)
			}
			if nextInstalled, updated := getPackageTimes(kind, "sample", target); nextInstalled != installed || updated == 0 {
				t.Fatalf("invalid update metadata: %d, %d", nextInstalled, updated)
			}
			if _, err := os.Stat(filepath.Join(target, "stale.txt")); !os.IsNotExist(err) {
				t.Fatalf("stale file survived update: %v", err)
			}
			if err := UninstallPackage(target); err != nil {
				t.Fatal(err)
			}
			if _, err := os.Stat(target); !os.IsNotExist(err) {
				t.Fatalf("uninstalled package remains: %v", err)
			}
			if _, err := os.Stat(filepath.Join(util.DataDir, "storage", "bazaar", kind, "sample.json")); !os.IsNotExist(err) {
				t.Fatalf("unexpected package state: %v", err)
			}
		})
	}
	if _, err := os.Stat(filepath.Join(util.DataDir, "storage", "bazaar.json")); err != nil {
		t.Fatalf("shared metadata missing: %v", err)
	}
}
