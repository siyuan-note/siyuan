package model

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
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

func createAppearanceMigrationDirectoryLink(t *testing.T, link, target string) {
	t.Helper()
	if err := os.Symlink(target, link); err != nil {
		if runtime.GOOS != "windows" {
			t.Skipf("symlinks unavailable: %v", err)
		}
		if output, err := exec.Command("cmd", "/d", "/c", "mklink", "/J", link, target).CombinedOutput(); err != nil {
			t.Skipf("directory links unavailable: %v %s", err, output)
		}
	}
}

func TestAppearanceMigrationRemovesExistingAliases(t *testing.T) {
	for _, layout := range []string{"shared-development-directory", "destination-points-to-source", "source-points-to-destination", "chained-development-links", "indirect-development-links"} {
		t.Run(layout, func(t *testing.T) {
			setupAppearancePackagesTest(t)
			external := t.TempDir()
			writeAppearanceTestFile(t, filepath.Join(external, "asset.txt"), "development asset")
			source := filepath.Join(util.AppearancePath, "themes", "linked")
			target := filepath.Join(util.ThemesPath, "linked")
			switch layout {
			case "shared-development-directory":
				createAppearanceMigrationDirectoryLink(t, source, external)
				createAppearanceMigrationDirectoryLink(t, target, external)
			case "destination-points-to-source":
				writeAppearanceTestFile(t, filepath.Join(source, "theme.css"), "development theme")
				createAppearanceMigrationDirectoryLink(t, filepath.Join(source, "assets"), external)
				createAppearanceMigrationDirectoryLink(t, target, source)
			case "source-points-to-destination":
				writeAppearanceTestFile(t, filepath.Join(target, "theme.css"), "development theme")
				createAppearanceMigrationDirectoryLink(t, source, target)
			case "chained-development-links", "indirect-development-links":
				createAppearanceMigrationDirectoryLink(t, source, external)
				link := source
				if layout == "indirect-development-links" {
					link = filepath.Join(t.TempDir(), "intermediate")
					createAppearanceMigrationDirectoryLink(t, link, source)
				}
				createAppearanceMigrationDirectoryLink(t, target, link)
			}
			if err := moveAppearancePackage(source, target); err != nil {
				t.Fatal(err)
			}
			if _, err := os.Lstat(source); !os.IsNotExist(err) {
				t.Fatalf("source alias remains: %v", err)
			}
			file, want := "theme.css", "development theme"
			if layout == "shared-development-directory" || layout == "chained-development-links" || layout == "indirect-development-links" {
				file, want = "asset.txt", "development asset"
			}
			if data, err := os.ReadFile(filepath.Join(target, file)); err != nil || string(data) != want {
				t.Fatalf("migrated package is unreadable: %q, %v", data, err)
			}
			if layout == "destination-points-to-source" {
				if data, err := os.ReadFile(filepath.Join(target, "assets", "asset.txt")); err != nil || string(data) != "development asset" {
					t.Fatalf("nested development link changed: %q, %v", data, err)
				}
			}
			if err := os.RemoveAll(target); err != nil {
				t.Fatal(err)
			}
			if err := MigrateAppearancePackages(); err != nil {
				t.Fatal(err)
			}
			if _, err := os.Lstat(target); !os.IsNotExist(err) {
				t.Fatalf("uninstalled package reappeared: %v", err)
			}
			if data, err := os.ReadFile(filepath.Join(external, "asset.txt")); err != nil || string(data) != "development asset" {
				t.Fatalf("external development files changed: %q, %v", data, err)
			}
		})
	}
}

func TestAppearanceMigrationPreservesAliasedParent(t *testing.T) {
	root := t.TempDir()
	writeAppearanceTestFile(t, filepath.Join(root, "themes", "shared", "theme.css"), "shared")
	alias := filepath.Join(t.TempDir(), "themes")
	createAppearanceMigrationDirectoryLink(t, alias, filepath.Join(root, "themes"))
	target := filepath.Join(root, "themes", "shared")
	if err := moveAppearancePackage(filepath.Join(alias, "shared"), target); err != nil {
		t.Fatal(err)
	}
	if data, err := os.ReadFile(filepath.Join(target, "theme.css")); err != nil || string(data) != "shared" {
		t.Fatalf("shared directory was removed: %q, %v", data, err)
	}
}

func TestAppearanceMigrationRelativeChainedLinks(t *testing.T) {
	root := t.TempDir()
	external := filepath.Join(root, "external")
	writeAppearanceTestFile(t, filepath.Join(external, "theme.css"), "development")
	source, target := filepath.Join(root, "source"), filepath.Join(root, "data", "target")
	if err := os.MkdirAll(filepath.Dir(target), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink("external", source); err != nil {
		t.Skipf("relative symlinks unavailable: %v", err)
	}
	if err := os.Symlink(filepath.Join("..", "source"), target); err != nil {
		t.Fatal(err)
	}
	if err := moveAppearancePackage(source, target); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Lstat(source); !os.IsNotExist(err) {
		t.Fatalf("source link remains: %v", err)
	}
	if data, err := os.ReadFile(filepath.Join(target, "theme.css")); err != nil || string(data) != "development" {
		t.Fatalf("relative link broke during migration: %q, %v", data, err)
	}
}
