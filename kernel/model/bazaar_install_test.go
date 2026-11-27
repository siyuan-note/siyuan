// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"archive/zip"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/bazaar"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func setupBoundInstallModel(t *testing.T) {
	t.Helper()
	setupSyncMutationTest(t)
	captureBazaarChanges(t)
	oldConfDir, oldData, oldTemp := util.ConfDir, util.DataDir, util.TempDir
	root := t.TempDir()
	util.ConfDir, util.DataDir, util.TempDir = filepath.Join(root, "conf"), filepath.Join(root, "data"), filepath.Join(root, "temp")
	t.Cleanup(func() { util.ConfDir, util.DataDir, util.TempDir = oldConfDir, oldData, oldTemp })
}

func writeBoundInstallArchive(t *testing.T, code string) (string, string) {
	t.Helper()
	return writeLocalInstallArchive(t, map[string]string{
		"plugin.json":      `{"name":"sample","version":"1.0.0"}`,
		"index.js":         code,
		"data/lookup.json": `{"label":"static resource"}`,
	})
}

func writeLocalInstallArchive(t *testing.T, files map[string]string) (string, string) {
	t.Helper()
	archivePath := filepath.Join(t.TempDir(), "package.zip")
	file, err := os.Create(archivePath)
	if err != nil {
		t.Fatal(err)
	}
	writer := zip.NewWriter(file)
	for name, value := range files {
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

func installBoundFixture(t *testing.T, code, expected string) *LocalBazaarPackageInstallResult {
	t.Helper()
	archive, hash := writeBoundInstallArchive(t, code)
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

func TestPreviewLocalBazaarPackageIsReadOnly(t *testing.T) {
	setupBoundInstallModel(t)
	archive, hash := writeBoundInstallArchive(t, "first")
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
	setupBoundInstallModel(t)
	first := installBoundFixture(t, "first", bazaar.MissingInstalledRevision)
	archive, hash := writeBoundInstallArchive(t, "second")
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
	}
}

func TestPluginPublishInstallRevokesRemovedFields(t *testing.T) {
	setupBoundInstallModel(t)
	first, _ := writeLocalInstallArchive(t, map[string]string{
		"plugin.json": `{"name":"sample","version":"1.0.0","publish":{"data":["removed","retained"]}}`,
	})
	if _, err := InstallLocalBazaarPackage(first, "", false); err != nil {
		t.Fatal(err)
	}
	if err := SetPluginPublishDataGrant("sample", []string{"removed", "retained"}, true); err != nil {
		t.Fatal(err)
	}
	if err := SavePluginPublishData("sample", map[string]json.RawMessage{"removed": json.RawMessage(`1`), "retained": json.RawMessage(`2`)}); err != nil {
		t.Fatal(err)
	}

	update, _ := writeLocalInstallArchive(t, map[string]string{
		"plugin.json": `{"name":"sample","version":"2.0.0","publish":{"data":["retained","newField"]}}`,
	})
	if _, err := InstallLocalBazaarPackage(update, "", true); err != nil {
		t.Fatal(err)
	}
	state, err := readPluginPublishState("sample")
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(state.Granted, []string{"retained"}) || len(state.Data) != 1 || string(state.Data["retained"]) != "2" {
		t.Fatalf("unexpected persisted publish state: %+v", state)
	}
}

func TestPluginPublishInstallPreservesPackageOnStateError(t *testing.T) {
	setupBoundInstallModel(t)
	first := installBoundFixture(t, "first", bazaar.MissingInstalledRevision)
	statePath := pluginPublishStatePath("sample")
	if err := os.MkdirAll(filepath.Dir(statePath), 0700); err != nil {
		t.Fatal(err)
	}
	const invalidState = `{"version":99}`
	if err := os.WriteFile(statePath, []byte(invalidState), 0600); err != nil {
		t.Fatal(err)
	}
	update, _ := writeBoundInstallArchive(t, "second")
	if _, err := InstallLocalBazaarPackage(update, "", true); !errors.Is(err, ErrPluginPublishInvalid) {
		t.Fatalf("install with unreadable publish state: %v", err)
	}
	revision, err := GetInstalledBazaarPackageRevision("plugins", "sample")
	if err != nil || revision != first.InstalledRevision {
		t.Fatalf("installed package changed after state error: %s, %v", revision, err)
	}
	state, err := os.ReadFile(statePath)
	if err != nil || string(state) != invalidState {
		t.Fatalf("publish state changed after state error: %s, %v", state, err)
	}
}

func TestBoundInstallUpdatesWithoutSeparateBackups(t *testing.T) {
	setupBoundInstallModel(t)
	first := installBoundFixture(t, "first", bazaar.MissingInstalledRevision)
	backupRoot := filepath.Join(util.ConfDir, "plugin-development", "install-backups")
	if _, err := os.Stat(backupRoot); !os.IsNotExist(err) {
		t.Fatalf("install created separate backups: %v", err)
	}
	// 已有私有文件不参与安装，也不由安装器清理。
	retained := filepath.Join(backupRoot, "retained", "code.zip")
	if err := os.MkdirAll(filepath.Dir(retained), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(retained, []byte("existing user file"), 0600); err != nil {
		t.Fatal(err)
	}
	runtimePath := filepath.Join(util.DataDir, "storage", "petal", "sample", "data.json")
	if err := os.MkdirAll(filepath.Dir(runtimePath), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(runtimePath, []byte(`{"value":7}`), 0600); err != nil {
		t.Fatal(err)
	}
	previous := first.InstalledRevision
	for i := range 33 {
		installed := installBoundFixture(t, fmt.Sprintf("version %d", i), previous)
		if !installed.Updated || installed.PreviousRevision != previous {
			t.Fatalf("update binding = %+v", installed)
		}
		data, err := json.Marshal(installed)
		if err != nil {
			t.Fatal(err)
		}
		var result map[string]any
		if err = json.Unmarshal(data, &result); err != nil {
			t.Fatal(err)
		}
		for _, name := range []string{"backupId", "restored", "enabled", "warnings"} {
			if _, exists := result[name]; exists {
				t.Fatalf("installation exposes removed recovery field %q", name)
			}
		}
		previous = installed.InstalledRevision
	}
	if data, err := os.ReadFile(filepath.Join(util.DataDir, "plugins", "sample", "data", "lookup.json")); err != nil || string(data) != `{"label":"static resource"}` {
		t.Fatalf("static data resource was not installed: %s, %v", data, err)
	}
	entries, err := os.ReadDir(backupRoot)
	if err != nil || len(entries) != 1 || entries[0].Name() != "retained" {
		t.Fatalf("installation changed separate backups: %v, %v", entries, err)
	}
	for name, expected := range map[string]string{retained: "existing user file", runtimePath: `{"value":7}`} {
		if data, err := os.ReadFile(name); err != nil || string(data) != expected {
			t.Fatalf("installation changed %s: %s, %v", name, data, err)
		}
	}
}
