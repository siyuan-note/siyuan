package model

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAppearanceMigrationMovesDirectoriesAndKeepsResiduals(t *testing.T) {
	setupAppearancePackagesTest(t)
	for _, kind := range []string{"themes", "icons"} {
		writeAppearanceTestFile(t, filepath.Join(util.AppearancePath, kind, "migrated", "assets", "file"), "legacy")
		writeAppearanceTestFile(t, filepath.Join(util.AppearancePath, kind, "custom", "file"), "superseded")
	}
	residuals := []string{
		filepath.Join(util.DataDir, "storage", "appearance-v1", "old.sypkg"),
		filepath.Join(util.DataDir, "storage", "bazaar", "themes", "migrated.json"),
		filepath.Join(util.DataDir, "storage", "bazaar", "icons", "migrated.json"),
		filepath.Join(util.ConfDir, "appearance-migration.json"),
	}
	for _, p := range residuals {
		writeAppearanceTestFile(t, p, "alpha residual")
	}
	if err := MigrateAppearancePackages(); err != nil {
		t.Fatal(err)
	}
	for _, kind := range []string{"themes", "icons"} {
		if data, err := os.ReadFile(filepath.Join(util.DataDir, kind, "migrated", "assets", "file")); err != nil || string(data) != "legacy" {
			t.Fatalf("package not migrated: %s: %q, %v", kind, data, err)
		}
		for _, name := range []string{"migrated", "custom"} {
			if _, err := os.Lstat(filepath.Join(util.AppearancePath, kind, name)); !os.IsNotExist(err) {
				t.Fatalf("source remains: %s/%s: %v", kind, name, err)
			}
		}
		if _, err := os.Stat(filepath.Join(util.DataDir, kind, "custom", "file")); !os.IsNotExist(err) {
			t.Fatalf("existing target overwritten: %v", err)
		}
	}
	for _, p := range residuals {
		if data, err := os.ReadFile(p); err != nil || string(data) != "alpha residual" {
			t.Fatalf("alpha residual changed: %s: %q, %v", p, data, err)
		}
	}
	if err := os.RemoveAll(filepath.Join(util.ThemesPath, "migrated")); err != nil {
		t.Fatal(err)
	}
	if err := MigrateAppearancePackages(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(util.ThemesPath, "migrated")); !os.IsNotExist(err) {
		t.Fatalf("deleted package reappeared: %v", err)
	}
	if _, err := os.Stat(filepath.Join(util.AppearancePath, "themes", "daylight", "theme.css")); err != nil {
		t.Fatalf("built-in theme moved: %v", err)
	}
}

func TestAppearanceMigrationPreservesDevelopmentLink(t *testing.T) {
	setupAppearancePackagesTest(t)
	external := t.TempDir()
	writeAppearanceTestFile(t, filepath.Join(external, "theme.css"), "development")
	source := filepath.Join(util.AppearancePath, "themes", "linked")
	if err := os.Symlink(external, source); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}
	if err := MigrateAppearancePackages(); err != nil {
		t.Fatal(err)
	}
	target := filepath.Join(util.ThemesPath, "linked")
	if info, err := os.Lstat(target); err != nil || info.Mode()&os.ModeSymlink == 0 {
		t.Fatalf("development link not preserved: %v", err)
	}
	if data, err := os.ReadFile(filepath.Join(target, "theme.css")); err != nil || string(data) != "development" {
		t.Fatalf("development files lost: %q, %v", data, err)
	}
	if _, err := os.Lstat(source); !os.IsNotExist(err) {
		t.Fatalf("original link remains: %v", err)
	}
}
