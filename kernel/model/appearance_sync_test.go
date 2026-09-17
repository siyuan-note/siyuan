package model

import (
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/siyuan-note/dejavu"
	"github.com/siyuan-note/dejavu/entity"
	"github.com/siyuan-note/siyuan/kernel/bazaar"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAppearanceIgnorePairsState(t *testing.T) {
	for _, rule := range []string{"/themes/example/", "/themes/", "/themes/example/theme.css"} {
		t.Run(rule, func(t *testing.T) {
			setupAppearanceMigrationTest(t)
			writeMigrationTestFile(t, util.DataDir, ".siyuan/syncignore", rule+"\n")
			statePath := filepath.Join(util.DataDir, "storage", "bazaar", "themes", "example.json")
			ignored, err := syncPathFilter(util.DataDir, nil, statePath)
			if err != nil {
				t.Fatal(err)
			}
			if want := rule != "/themes/example/theme.css"; ignored != want {
				t.Fatalf("state excluded=%t, want %t", ignored, want)
			}
		})
	}
}

func TestAppearanceIgnoreLinkedPackageState(t *testing.T) {
	setupAppearanceMigrationTest(t)
	if err := os.MkdirAll(util.ThemesPath, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(t.TempDir(), filepath.Join(util.ThemesPath, "example")); err != nil {
		t.Skipf("symlinks unavailable: %s", err)
	}
	for _, name := range []string{"themes/example/theme.css", "storage/bazaar/themes/example.json"} {
		ignored, err := syncPathFilter(util.DataDir, nil, filepath.Join(util.DataDir, filepath.FromSlash(name)))
		if err != nil || !ignored {
			t.Fatalf("linked package component %s: ignored=%t, error=%v", name, ignored, err)
		}
	}
}

func TestAppearanceChangedPackages(t *testing.T) {
	result := &dejavu.MergeResult{Upserts: []*entity.File{{Path: "/themes/example/theme.css"}, {Path: "/themes/example/assets/font.woff"}, {Path: "/storage/bazaar/icons/other.json"}, {Path: "/storage/bazaar.json"}, {Path: "/storage/appearance-v1/themes/shared/version.sypkg"}}, Removes: []*entity.File{{Path: "/icons/other/icon.js"}, {Path: "/storage/bazaar/themes/deleted.json"}, {Path: "/storage/appearance-v1/icons/shared/version.sypkg"}}}
	themes, icons := appearanceChangedPackages(result)
	if !reflect.DeepEqual(themes, []string{"deleted", "example"}) || !reflect.DeepEqual(icons, []string{"other"}) {
		t.Fatalf("unexpected refresh: themes=%v icons=%v", themes, icons)
	}
}

func TestAppearancePrepareSeparatesUserIgnoreFromIsolation(t *testing.T) {
	setupAppearanceMigrationTest(t)
	writeMigrationTestFile(t, util.DataDir, ".siyuan/syncignore", "/icons/\n/themes/local/\n")
	for _, name := range []string{"shared", "local"} {
		writeMigrationTestFile(t, util.ThemesPath, name+"/theme.css", "local css")
	}
	writeMigrationTestFile(t, util.IconsPath, "local/icon.js", "local icon")
	if err := prepareAppearancePackages(); err != nil {
		t.Fatal(err)
	}
	if err := bazaar.ValidateAppearancePackage("themes", "shared"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(util.DataDir, "storage", "bazaar", "themes", "shared.json")); err != nil {
		t.Fatalf("isolation incorrectly disabled appearance synchronization: %v", err)
	}
	for _, name := range []string{"themes/local.json", "icons/local.json"} {
		if _, err := os.Stat(filepath.Join(util.DataDir, "storage", "bazaar", filepath.FromSlash(name))); !os.IsNotExist(err) {
			t.Fatalf("user-ignored package received state: %s: %v", name, err)
		}
	}
	userLines, err := loadAppearanceSyncIgnoreLines()
	if err != nil {
		t.Fatal(err)
	}
	for _, line := range userLines {
		if strings.HasPrefix(line, "# siyuan-appearance-isolation:") || line == "/themes/" || line == "/storage/bazaar/themes/" {
			t.Fatalf("managed rule remained in user intent: %s", line)
		}
	}
}
