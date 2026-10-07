package model

import (
	"archive/zip"
	"crypto/sha256"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/bazaar"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func setupInstallBackupModel(t *testing.T) {
	t.Helper()
	setupSyncMutationTest(t)
	captureBazaarChanges(t)
	oldConfDir, oldData, oldTemp := util.ConfDir, util.DataDir, util.TempDir
	root := t.TempDir()
	util.ConfDir, util.DataDir, util.TempDir = filepath.Join(root, "conf"), filepath.Join(root, "data"), filepath.Join(root, "temp")
	t.Cleanup(func() { util.ConfDir, util.DataDir, util.TempDir = oldConfDir, oldData, oldTemp })
}

func writeInstallBackupArchive(t *testing.T, code string) (string, string) {
	t.Helper()
	archivePath := filepath.Join(t.TempDir(), "package.zip")
	file, err := os.Create(archivePath)
	if err != nil {
		t.Fatal(err)
	}
	writer := zip.NewWriter(file)
	for name, value := range map[string]string{"plugin.json": `{"name":"sample","version":"1.0.0"}`, "index.js": code} {
		entry, err := writer.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = entry.Write([]byte(value)); err != nil {
			t.Fatal(err)
		}
	}
	if err = writer.Close(); err != nil {
		t.Fatal(err)
	}
	if err = file.Close(); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(archivePath)
	if err != nil {
		t.Fatal(err)
	}
	return archivePath, fmt.Sprintf("%x", sha256.Sum256(data))
}

func installBoundBackupFixture(t *testing.T, code, expected string) *LocalBazaarPackageInstallResult {
	t.Helper()
	archive, hash := writeInstallBackupArchive(t, code)
	result, err := InstallLocalBazaarPackageWithOptions(archive, "", true, LocalBazaarInstallOptions{
		ExpectedPackageHash: hash, ExpectedInstalledRevision: expected,
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.PackageHash != hash || result.InstalledRevision == "" {
		t.Fatalf("binding result = %+v", result)
	}
	return result
}

func TestBoundLocalInstallAndDisabledCodeRestore(t *testing.T) {
	setupInstallBackupModel(t)
	first := installBoundBackupFixture(t, "first", bazaar.MissingInstalledRevision)
	dependency := filepath.Join(util.DataDir, "plugins", "sample", "node_modules", "marked", "index.js")
	if err := os.MkdirAll(filepath.Dir(dependency), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(dependency, []byte("module.exports = {}"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(util.DataDir, "plugins", "sample", "index.js"), []byte("module.exports = require('marked')"), 0644); err != nil {
		t.Fatal(err)
	}
	first.InstalledRevision, _ = GetInstalledBazaarPackageRevision("plugins", "sample")
	storage := filepath.Join(util.DataDir, "storage", "petal")
	if err := os.MkdirAll(filepath.Join(storage, "sample"), 0755); err != nil {
		t.Fatal(err)
	}
	runtimePath := filepath.Join(storage, "sample", "data.json")
	if err := os.WriteFile(runtimePath, []byte(`{"token":"runtime-secret","value":7}`), 0600); err != nil {
		t.Fatal(err)
	}
	other := filepath.Join(util.DataDir, "plugins", "other")
	if err := os.MkdirAll(other, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(other, "plugin.json"), []byte(`{"name":"other","version":"1.0.0"}`), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(storage, "petals.json"), []byte(`[{"name":"sample","enabled":true},{"name":"other","enabled":true}]`), 0600); err != nil {
		t.Fatal(err)
	}
	oldStart, oldStop := OnKernelPluginStart, OnKernelPluginStop
	starts, stops := 0, 0
	OnKernelPluginStart = func(*Petal) { starts++ }
	OnKernelPluginStop = func(*Petal) { stops++ }
	t.Cleanup(func() { OnKernelPluginStart, OnKernelPluginStop = oldStart, oldStop })
	second := installBoundBackupFixture(t, "second", first.InstalledRevision)
	if second.BackupID == "" {
		t.Fatal("replacement did not retain a recovery point")
	}
	backup, err := GetLocalBazaarInstallBackup(second.BackupID)
	if err != nil {
		t.Fatal(err)
	}
	if backup.PreviousEnabled == nil || !*backup.PreviousEnabled || backup.InstalledRevision != first.InstalledRevision {
		t.Fatalf("backup state = %+v", backup)
	}
	preview, err := PreviewLocalBazaarRestore(second.BackupID, backup.PackageHash)
	if err != nil || preview.PackageHash != backup.PackageHash || preview.InstalledRevision != second.InstalledRevision || !preview.ConfiguredEnabled {
		t.Fatalf("restore preview = %+v, %v", preview, err)
	}
	beforeRestoreStarts := starts
	restored, err := RestoreLocalBazaarPackage(second.BackupID, "", second.InstalledRevision, backup.PackageHash)
	if err != nil {
		t.Fatal(err)
	}
	if !restored.Restored || restored.Enabled == nil || *restored.Enabled || restored.BackupID == "" {
		t.Fatalf("restore result = %+v", restored)
	}
	if starts != beforeRestoreStarts || stops != 1 {
		t.Fatalf("restore lifecycle starts=%d, stops=%d", starts, stops)
	}
	if enabled, err := readPluginEnabledForInstall("sample"); err != nil || enabled {
		t.Fatalf("restored plugin not disabled: %v, %v", enabled, err)
	}
	if enabled, err := readPluginEnabledForInstall("other"); err != nil || !enabled {
		t.Fatal("restore changed another plugin's configuration")
	}
	data, err := os.ReadFile(filepath.Join(util.DataDir, "plugins", "sample", "index.js"))
	if err != nil || string(data) != "module.exports = require('marked')" {
		t.Fatalf("restored code = %s, %v", data, err)
	}
	data, err = os.ReadFile(dependency)
	if err != nil || string(data) != "module.exports = {}" {
		t.Fatal("restore lost a packaged code dependency")
	}
	data, err = os.ReadFile(runtimePath)
	if err != nil || string(data) != `{"token":"runtime-secret","value":7}` {
		t.Fatal("restore changed runtime data")
	}
	if !strings.Contains(strings.Join(restored.Warnings, " "), "does not acknowledge unload") {
		t.Fatal("restore hides missing frontend unload acknowledgement")
	}
	list, err := ListLocalBazaarInstallBackups("sample")
	if err != nil || len(list) != 2 {
		t.Fatalf("retained recovery points = %d, %v", len(list), err)
	}
}

func TestPreviewLocalBazaarPackageIsReadOnly(t *testing.T) {
	setupInstallBackupModel(t)
	archive, hash := writeInstallBackupArchive(t, "first")
	preview, err := PreviewLocalBazaarPackage(archive, hash)
	if err != nil {
		t.Fatal(err)
	}
	if preview.PackageType != "plugins" || preview.PackageName != "sample" || preview.Version != "1.0.0" || preview.PackageHash != hash || preview.InstalledRevision != bazaar.MissingInstalledRevision || preview.ConfiguredEnabled {
		t.Fatalf("preview = %+v", preview)
	}
	for _, directory := range []string{util.ConfDir, util.DataDir, util.TempDir} {
		if _, err = os.Stat(directory); !os.IsNotExist(err) {
			t.Fatalf("preview created %s", directory)
		}
	}
	if _, err = PreviewLocalBazaarPackage(archive, strings.Repeat("0", 64)); !errors.Is(err, bazaar.ErrPackageHashConflict) {
		t.Fatalf("preview accepted changed archive: %v", err)
	}
}

func TestBoundInstallRejectsHashAndTargetRevisionWithoutMutation(t *testing.T) {
	setupInstallBackupModel(t)
	first := installBoundBackupFixture(t, "first", bazaar.MissingInstalledRevision)
	archive, hash := writeInstallBackupArchive(t, "second")
	for _, options := range []LocalBazaarInstallOptions{
		{ExpectedPackageHash: strings.Repeat("0", 64), ExpectedInstalledRevision: first.InstalledRevision},
		{ExpectedPackageHash: hash, ExpectedInstalledRevision: bazaar.MissingInstalledRevision},
	} {
		if _, err := InstallLocalBazaarPackageWithOptions(archive, "", true, options); err == nil {
			t.Fatal("stale binding accepted")
		}
		if revision, err := GetInstalledBazaarPackageRevision("plugins", "sample"); err != nil || revision != first.InstalledRevision {
			t.Fatal("stale binding changed target")
		}
		list, err := ListLocalBazaarInstallBackups("sample")
		if err != nil || len(list) != 0 {
			t.Fatal("stale binding created recovery points")
		}
	}
}

func TestRestoreRejectsStaleTargetAndTamperedBackup(t *testing.T) {
	setupInstallBackupModel(t)
	first := installBoundBackupFixture(t, "first", bazaar.MissingInstalledRevision)
	second := installBoundBackupFixture(t, "second", first.InstalledRevision)
	backup, err := GetLocalBazaarInstallBackup(second.BackupID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = RestoreLocalBazaarPackage(second.BackupID, "", first.InstalledRevision, backup.PackageHash); !errors.Is(err, bazaar.ErrInstalledRevisionConflict) {
		t.Fatalf("stale restore = %v", err)
	}
	if _, err = RestoreLocalBazaarPackage(second.BackupID, "", second.InstalledRevision, strings.Repeat("0", 64)); !errors.Is(err, bazaar.ErrPackageHashConflict) {
		t.Fatalf("wrong restore hash = %v", err)
	}
	archive := filepath.Join(bazaar.DefaultInstallBackupRoot(), backup.ID, "code.zip")
	if err = os.WriteFile(archive, []byte("tampered archive"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err = RestoreLocalBazaarPackage(second.BackupID, "", second.InstalledRevision, backup.PackageHash); !errors.Is(err, bazaar.ErrPackageHashConflict) {
		t.Fatalf("tampered restore = %v", err)
	}
	if revision, err := GetInstalledBazaarPackageRevision("plugins", "sample"); err != nil || revision != second.InstalledRevision {
		t.Fatal("rejected restore changed code")
	}
	list, err := ListLocalBazaarInstallBackups("sample")
	if err != nil || len(list) != 1 {
		t.Fatalf("rejected restore changed backup count: %d, %v", len(list), err)
	}
}

func TestRestoreMissingPluginRemainsDisabled(t *testing.T) {
	setupInstallBackupModel(t)
	first := installBoundBackupFixture(t, "first", bazaar.MissingInstalledRevision)
	second := installBoundBackupFixture(t, "second", first.InstalledRevision)
	backup, err := GetLocalBazaarInstallBackup(second.BackupID)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.RemoveAll(filepath.Join(util.DataDir, "plugins", "sample")); err != nil {
		t.Fatal(err)
	}
	result, err := RestoreLocalBazaarPackage(second.BackupID, "", bazaar.MissingInstalledRevision, backup.PackageHash)
	if err != nil || !result.Restored || result.Enabled == nil || *result.Enabled || result.Updated {
		t.Fatalf("missing restore = %+v, %v", result, err)
	}
	if enabled, err := readPluginEnabledForInstall("sample"); err != nil || enabled {
		t.Fatalf("missing restore enabled plugin: %v, %v", enabled, err)
	}
}
