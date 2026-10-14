package model

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/util"
)

func captureBazaarChanges(t *testing.T) *[]string {
	t.Helper()
	previous := pushBazaarChanged
	var changes []string
	pushBazaarChanged = func(pkgType string) { changes = append(changes, pkgType) }
	t.Cleanup(func() { pushBazaarChanged = previous })
	return &changes
}

func TestBazaarChangedAfterInstall(t *testing.T) {
	setupSyncMutationTest(t)
	setupAppearancePackagesTest(t)
	t.Cleanup(CloseWatchThemes)
	changes := captureBazaarChanges(t)
	for _, pkgType := range []string{"plugins", "themes", "icons", "widgets", "templates"} {
		t.Run(pkgType, func(t *testing.T) {
			*changes = nil
			finishInstall(pkgType, nil, nil, false)
			if len(*changes) != 0 {
				t.Fatal("empty or entirely failed batch must not notify")
			}
			finishInstall(pkgType, []batchInstallItem{{name: "sample"}}, nil, false)
			if len(*changes) != 1 || (*changes)[0] != pkgType {
				t.Fatalf("new installation notification = %v", *changes)
			}
			*changes = nil
			finishInstall(pkgType, []batchInstallItem{
				{name: "sample", meta: installMeta{update: true}},
				{name: "other", meta: installMeta{update: true}},
			}, nil, false)
			if len(*changes) != 1 || (*changes)[0] != pkgType {
				t.Fatalf("batch update notification = %v", *changes)
			}
		})
	}
}

func TestBazaarChangedAfterUninstall(t *testing.T) {
	setupSyncMutationTest(t)
	changes := captureBazaarChanges(t)
	packagePath := filepath.Join(util.DataDir, "widgets", "sample")
	if err := os.MkdirAll(packagePath, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(packagePath, "widget.json"), []byte(`{"name":"sample","version":"1.0.0"}`), 0644); err != nil {
		t.Fatal(err)
	}
	if err := UninstallPackage("widgets", "sample"); err != nil {
		t.Fatal(err)
	}
	if len(*changes) != 1 || (*changes)[0] != "widgets" {
		t.Fatalf("uninstall notification = %v", *changes)
	}
	if _, err := os.Stat(packagePath); !os.IsNotExist(err) {
		t.Fatalf("package still exists after uninstall: %v", err)
	}
	if err := UninstallPackage("widgets", "sample"); err == nil {
		t.Fatal("expected missing package error")
	}
	if len(*changes) != 1 {
		t.Fatal("failed uninstall must not notify")
	}
}
