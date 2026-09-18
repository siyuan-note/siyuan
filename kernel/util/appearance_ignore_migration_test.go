package util

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestAppearanceIgnoreMigration(t *testing.T) {
	block := "# siyuan-appearance-isolation:v1:begin\n/themes/\n/icons/\n/storage/bazaar/themes/\n/storage/bazaar/icons/\n# siyuan-appearance-isolation:v1:end\n"
	for _, newline := range []string{"\n", "\r\n"} {
		for _, bom := range []string{"", "\ufeff"} {
			t.Run(newline+bom, func(t *testing.T) {
				old := DataDir
				DataDir = t.TempDir()
				t.Cleanup(func() { DataDir = old })
				p := filepath.Join(DataDir, ".siyuan", "syncignore")
				if err := os.MkdirAll(filepath.Dir(p), 0755); err != nil {
					t.Fatal(err)
				}
				original := bom + strings.ReplaceAll(block+"/themes/\n# custom\n"+block+"!/icons/custom/", "\n", newline)
				want := bom + strings.ReplaceAll("/themes/\n# custom\n!/icons/custom/", "\n", newline)
				if err := os.WriteFile(p, []byte(original), 0644); err != nil {
					t.Fatal(err)
				}
				if err := MigrateAppearanceSyncIgnore(); err != nil {
					t.Fatal(err)
				}
				if got, err := os.ReadFile(p); err != nil || string(got) != want {
					t.Fatalf("user rules changed: %q, %v", got, err)
				}
				before, _ := os.Stat(p)
				if err := MigrateAppearanceSyncIgnore(); err != nil {
					t.Fatal(err)
				}
				after, _ := os.Stat(p)
				if !before.ModTime().Equal(after.ModTime()) {
					t.Fatal("completed migration rewrote syncignore")
				}
			})
		}
	}
	for _, bad := range []string{strings.ReplaceAll(block, "v1", "v2"), strings.ReplaceAll(block, "/themes/", "/custom/"), "# siyuan-appearance-isolation:v1:begin\n"} {
		if _, err := removeAppearanceIsolationBlock([]byte(bad)); err == nil {
			t.Fatal("modified block silently removed")
		}
	}
}
