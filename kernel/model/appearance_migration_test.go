package model

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/bazaar"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func setupAppearanceMigrationTest(t *testing.T) string {
	t.Helper()
	oldData, oldConf, oldAppearance, oldThemes, oldIcons, oldMode := util.DataDir, util.ConfDir, util.AppearancePath, util.ThemesPath, util.IconsPath, util.Mode
	root := t.TempDir()
	util.DataDir, util.ConfDir = filepath.Join(root, "data"), filepath.Join(root, "conf")
	util.AppearancePath = filepath.Join(util.ConfDir, "appearance")
	util.ThemesPath, util.IconsPath, util.Mode = filepath.Join(util.DataDir, "themes"), filepath.Join(util.DataDir, "icons"), "prod"
	t.Cleanup(func() {
		util.DataDir, util.ConfDir, util.AppearancePath, util.ThemesPath, util.IconsPath, util.Mode = oldData, oldConf, oldAppearance, oldThemes, oldIcons, oldMode
	})
	return root
}

func writeMigrationTestFile(t *testing.T, root, name, data string) {
	t.Helper()
	filePath := filepath.Join(root, filepath.FromSlash(name))
	if err := os.MkdirAll(filepath.Dir(filePath), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filePath, []byte(data), 0644); err != nil {
		t.Fatal(err)
	}
}

func TestAppearanceMigrationPreservesSourceAndDeletion(t *testing.T) {
	setupAppearanceMigrationTest(t)
	writeMigrationTestFile(t, util.AppearancePath, "themes/daylight/theme.css", "builtin")
	writeMigrationTestFile(t, util.AppearancePath, "themes/example/theme.css", "legacy")
	writeMigrationTestFile(t, util.AppearancePath, "icons/removed/icon.js", "must not return")
	writeMigrationTestFile(t, util.AppearancePath, "themes/existing/theme.css", "old legacy")
	writeMigrationTestFile(t, util.ThemesPath, "existing/theme.css", "current data")
	if err := bazaar.DeleteAppearancePackage("icons", "removed"); err != nil {
		t.Fatal(err)
	}
	if err := MigrateAppearancePackages(); err != nil {
		t.Fatal(err)
	}
	for _, root := range []string{util.AppearancePath, util.DataDir} {
		data, err := os.ReadFile(filepath.Join(root, "themes", "example", "theme.css"))
		if err != nil || string(data) != "legacy" {
			t.Fatalf("migration/source: %s %v", data, err)
		}
	}
	for _, name := range []string{"themes/daylight", "icons/removed"} {
		if _, err := os.Stat(filepath.Join(util.DataDir, filepath.FromSlash(name))); !os.IsNotExist(err) {
			t.Fatalf("unexpected migrated package %s: %v", name, err)
		}
	}
	data, err := os.ReadFile(filepath.Join(util.ThemesPath, "existing", "theme.css"))
	if err != nil || string(data) != "current data" {
		t.Fatalf("existing target overwritten: %s %v", data, err)
	}
	state, _ := os.ReadFile(filepath.Join(util.DataDir, "storage", "bazaar", "themes", "example.json"))
	if !strings.Contains(string(state), `"migration": true`) {
		t.Fatalf("migration origin missing: %s", state)
	}
	if err = bazaar.DeleteAppearancePackage("themes", "example"); err != nil {
		t.Fatal(err)
	}
	if err = MigrateAppearancePackages(); err != nil {
		t.Fatal(err)
	}
	if _, err = os.Stat(filepath.Join(util.ThemesPath, "example")); !os.IsNotExist(err) {
		t.Fatal("migration resurrected removed package", err)
	}
}

func TestAppearanceMigrationUnknownJournalPreserved(t *testing.T) {
	setupAppearanceMigrationTest(t)
	writeMigrationTestFile(t, util.ConfDir, "appearance-migration.json", `{"version":2,"completed":false}`)
	writeMigrationTestFile(t, util.AppearancePath, "themes/example/theme.css", "original")
	if err := MigrateAppearancePackages(); err == nil {
		t.Fatal("unknown migration accepted")
	}
	data, _ := os.ReadFile(filepath.Join(util.ConfDir, "appearance-migration.json"))
	if string(data) != `{"version":2,"completed":false}` {
		t.Fatal("unknown migration journal overwritten")
	}
	if _, err := os.Stat(filepath.Join(util.ThemesPath, "example")); !os.IsNotExist(err) {
		t.Fatal("unknown migration wrote payload")
	}
}

func TestAppearanceMigrationSkipsEmptyDirectories(t *testing.T) {
	setupAppearanceMigrationTest(t)
	for _, name := range []string{"empty", "ignored"} {
		if err := os.MkdirAll(filepath.Join(util.AppearancePath, "themes", name), 0755); err != nil {
			t.Fatal(err)
		}
	}
	writeMigrationTestFile(t, util.AppearancePath, "themes/ignored/.draft", "keep original")
	writeMigrationTestFile(t, util.AppearancePath, "themes/example/theme.css", "legacy")
	if err := MigrateAppearancePackages(); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"empty", "ignored"} {
		if _, err := os.Stat(filepath.Join(util.AppearancePath, "themes", name)); err != nil {
			t.Fatalf("source directory was not preserved: %v", err)
		}
		for _, target := range []string{
			filepath.Join(util.ThemesPath, name),
			filepath.Join(util.DataDir, "storage", "bazaar", "themes", name+".json"),
		} {
			if _, err := os.Stat(target); !os.IsNotExist(err) {
				t.Fatalf("empty directory received synchronized state: %s: %v", target, err)
			}
		}
	}
	data, err := os.ReadFile(filepath.Join(util.AppearancePath, "themes", "ignored", ".draft"))
	if err != nil || string(data) != "keep original" {
		t.Fatalf("ignored source file changed: %s %v", data, err)
	}
	if err = bazaar.ValidateAppearancePackage("themes", "example"); err != nil {
		t.Fatal(err)
	}
	if _, err = os.Stat(filepath.Join(util.ThemesPath, "example", "theme.css")); err != nil {
		t.Fatalf("nonempty package was not migrated: %v", err)
	}
}

func TestAppearanceStatePayloadPath(t *testing.T) {
	for input, want := range map[string]string{
		"/storage/bazaar/themes/example.json":  "themes/example/",
		"/storage/bazaar/icons/example.json":   "icons/example/",
		"/storage/bazaar.json":                 "",
		"/storage/bazaar/plugins/example.json": "",
		"/themes/example/theme.css":            "",
	} {
		if got := appearanceStatePayloadPath(input); got != want {
			t.Fatalf("%s = %s; want %s", input, got, want)
		}
	}
}

func TestAppearanceMigrationPreservesLinkedPackages(t *testing.T) {
	for _, nested := range []bool{false, true} {
		name := "root"
		if nested {
			name = "nested"
		}
		t.Run(name, func(t *testing.T) {
			setupAppearanceMigrationTest(t)
			source := filepath.Join(util.AppearancePath, "themes", "linked")
			original := t.TempDir()
			writeMigrationTestFile(t, original, "theme.css", "original")
			if err := os.MkdirAll(filepath.Dir(source), 0755); err != nil {
				t.Fatal(err)
			}
			if nested {
				writeMigrationTestFile(t, source, "theme.json", `{"name":"linked","version":"1.0.0","modes":["light"]}`)
				writeMigrationTestFile(t, source, "real.css", "original")
				if err := os.Symlink("real.css", filepath.Join(source, "theme.css")); err != nil {
					t.Skipf("symlinks unavailable: %s", err)
				}
			} else if err := os.Symlink(original, source); err != nil {
				t.Skipf("symlinks unavailable: %s", err)
			}
			if err := MigrateAppearancePackages(); err != nil {
				t.Fatal(err)
			}
			target := util.AppearancePackagePath("themes", "linked")
			info, err := os.Lstat(target)
			if err != nil || info.Mode()&os.ModeSymlink == 0 {
				t.Fatalf("linked development package was not preserved: %v", err)
			}
			for _, root := range []string{source, target} {
				data, readErr := os.ReadFile(filepath.Join(root, "theme.css"))
				if readErr != nil || string(data) != "original" {
					t.Fatalf("source or migrated package changed: %s %v", data, readErr)
				}
			}
			if err = bazaar.PrepareAppearancePackages(); err != nil {
				t.Fatal(err)
			}
			statePath := filepath.Join(util.DataDir, "storage", "bazaar", "themes", "linked.json")
			if _, err = os.Stat(statePath); !os.IsNotExist(err) {
				t.Fatalf("linked development package received synchronization state: %v", err)
			}
			if ignored, filterErr := syncPathFilter(util.DataDir, info, target); !ignored || filterErr != nil {
				t.Fatalf("linked package was included in synchronization: %t %v", ignored, filterErr)
			}
			if err = MigrateAppearancePackages(); err != nil {
				t.Fatalf("repeated linked package migration failed: %s", err)
			}
		})
	}
}
