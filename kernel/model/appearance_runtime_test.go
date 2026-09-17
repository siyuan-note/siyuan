// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/siyuan-note/dejavu"
	"github.com/siyuan-note/dejavu/entity"
	dejavuutil "github.com/siyuan-note/dejavu/util"
	"github.com/siyuan-note/siyuan/kernel/bazaar"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func setupRecordedAppearanceRuntimeTest(t *testing.T) string {
	t.Helper()
	setupAppearancePackagesTest(t)
	Conf.Repo = conf.NewRepo()
	Conf.Repo.Key = []byte("0123456789abcdef0123456789abcdef")
	Conf.Appearance.ThemeLight, Conf.Appearance.Icon = "custom", "custom"
	if err := bazaar.PrepareAppearancePackages(); err != nil {
		t.Fatal(err)
	}
	return filepath.Join(util.DataDir, "storage", "bazaar", "themes", "custom.json")
}

func writeAppearanceRecoveryRuntimeTest(t *testing.T, state any) []byte {
	t.Helper()
	data, err := json.Marshal(state)
	if err != nil {
		t.Fatal(err)
	}
	store, err := dejavu.NewStore(t.TempDir(), Conf.Repo.Key)
	if err != nil {
		t.Fatal(err)
	}
	chunk := &entity.Chunk{ID: dejavuutil.Hash(data), Data: data}
	if err = store.PutChunk(chunk); err != nil {
		t.Fatal(err)
	}
	_, objectPath := store.AbsPath(chunk.ID)
	ciphertext, err := os.ReadFile(objectPath)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(assetDownloadStatePath(), ciphertext, 0600); err != nil {
		t.Fatal(err)
	}
	return ciphertext
}

func TestAppearanceRuntimeManualEditRemainsLoadableAndExportable(t *testing.T) {
	statePath := setupRecordedAppearanceRuntimeTest(t)
	before, err := os.ReadFile(statePath)
	if err != nil {
		t.Fatal(err)
	}
	writeAppearanceTestFile(t, filepath.Join(util.ThemesPath, "custom", "theme.css"), "manually edited CSS")
	writeAppearanceTestFile(t, filepath.Join(util.ThemesPath, "custom", "theme.js"), "manually added script")
	if err = bazaar.ValidateAppearancePackage("themes", "custom"); err == nil {
		t.Fatal("strict snapshot validation accepted an unrecorded change")
	}
	refreshAppearanceConfig()
	if Conf.Appearance.ThemeLight != "custom" || !Conf.Appearance.ThemeJS || !containTheme("custom", Conf.Appearance.LightThemes) {
		t.Fatal("manual edit disabled the current theme")
	}
	destination := t.TempDir()
	if err = copyExportAppearance(destination, "custom", "custom"); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(filepath.Join(destination, "appearance", "themes", "custom", "theme.css"))
	if err != nil || string(data) != "manually edited CSS" {
		t.Fatalf("manual edit was not exported: %s %v", data, err)
	}
	after, _ := os.ReadFile(statePath)
	if !bytes.Equal(before, after) {
		t.Fatal("runtime loading or export rewrote synchronization state")
	}
}

func TestAppearanceRuntimePendingPreservesSelectionAndStrictness(t *testing.T) {
	statePath := setupRecordedAppearanceRuntimeTest(t)
	before, _ := os.ReadFile(statePath)
	writeAppearanceTestFile(t, filepath.Join(util.ThemesPath, "custom", "theme.css"), "unrecorded pending contents")
	file := &entity.File{ID: strings.Repeat("1", 40), Path: "/themes/custom/theme.css", Chunks: []string{strings.Repeat("2", 40)}}
	state := map[string]any{"version": 1, "scope": "runtime-test", "deferred": map[string]*entity.File{}, "pending": map[string]any{
		"index": &entity.Index{}, "base": &entity.Index{}, "deferred": map[string]*entity.File{},
		"before": map[string]*entity.File{}, "upserts": []*entity.File{file},
	}}
	writeAppearanceRecoveryRuntimeTest(t, state)
	refreshAppearanceConfig()
	if Conf.Appearance.ThemeLight != "custom" || containTheme("custom", Conf.Appearance.LightThemes) || Conf.Appearance.ThemeJS {
		t.Fatal("pending package was loaded or its local selection was discarded")
	}
	if !containIcon("custom", Conf.Appearance.Icons) {
		t.Fatal("unrelated package was disabled by a pending theme")
	}
	if err := copyExportAppearance(t.TempDir(), "custom", "custom"); err == nil {
		t.Fatal("pending unverified package was exported")
	}
	after, _ := os.ReadFile(statePath)
	if !bytes.Equal(before, after) {
		t.Fatal("pending package state was rewritten")
	}
	delete(state, "pending")
	writeAppearanceRecoveryRuntimeTest(t, state)
	refreshAppearanceConfig()
	if Conf.Appearance.ThemeLight != "custom" || !containTheme("custom", Conf.Appearance.LightThemes) {
		t.Fatal("selection did not become available after recovery completed")
	}
}

func TestAppearanceRuntimeUnknownRecoveryPreservesSelection(t *testing.T) {
	setupRecordedAppearanceRuntimeTest(t)
	ciphertext := writeAppearanceRecoveryRuntimeTest(t, map[string]any{"version": 99, "scope": "runtime-test", "deferred": map[string]any{}})
	refreshAppearanceConfig()
	if Conf.Appearance.ThemeLight != "custom" || Conf.Appearance.Icon != "custom" ||
		containTheme("custom", Conf.Appearance.LightThemes) || containIcon("custom", Conf.Appearance.Icons) {
		t.Fatal("unknown recovery state was accepted or discarded the local selection")
	}
	if !containTheme("daylight", Conf.Appearance.LightThemes) || !containIcon("litheness", Conf.Appearance.Icons) {
		t.Fatal("unknown recovery state disabled built-in resources")
	}
	after, _ := os.ReadFile(assetDownloadStatePath())
	if !bytes.Equal(ciphertext, after) {
		t.Fatal("unknown recovery state was modified")
	}
}

func TestAppearanceRuntimeLegacyDeferredIsUnavailable(t *testing.T) {
	setupAppearancePackagesTest(t)
	Conf.Repo = conf.NewRepo()
	Conf.Repo.Key = []byte("0123456789abcdef0123456789abcdef")
	Conf.Appearance.ThemeLight = "custom"
	file := &entity.File{ID: strings.Repeat("1", 40), Path: "/themes/custom/assets/font.woff2", Chunks: []string{strings.Repeat("2", 40)}}
	state := map[string]any{"version": 1, "scope": "runtime-test", "deferred": map[string]*entity.File{file.Path: file}}
	writeAppearanceRecoveryRuntimeTest(t, state)
	refreshAppearanceConfig()
	if Conf.Appearance.ThemeLight != "custom" || containTheme("custom", Conf.Appearance.LightThemes) {
		t.Fatal("legacy theme with deferred resources was loaded or its selection discarded")
	}
	state["deferred"] = map[string]*entity.File{}
	writeAppearanceRecoveryRuntimeTest(t, state)
	refreshAppearanceConfig()
	if Conf.Appearance.ThemeLight != "custom" || !containTheme("custom", Conf.Appearance.LightThemes) {
		t.Fatal("legacy theme did not become available after resources completed")
	}
}

func TestAppearanceRuntimeLocalPendingAndDeletedFallback(t *testing.T) {
	statePath := setupRecordedAppearanceRuntimeTest(t)
	state, err := os.ReadFile(statePath)
	if err != nil {
		t.Fatal(err)
	}
	operation := map[string]any{"version": 1, "kind": "themes", "name": "custom", "state": json.RawMessage(state)}
	data, err := json.Marshal(operation)
	if err != nil {
		t.Fatal(err)
	}
	opPath := filepath.Join(util.DataDir, ".siyuan-appearance-ops", "package-runtime", "operation.json")
	writeAppearanceTestFile(t, opPath, string(data))
	writeAppearanceTestFile(t, filepath.Join(util.ThemesPath, "custom", "theme.css"), "pending local replacement")
	refreshAppearanceConfig()
	if Conf.Appearance.ThemeLight != "custom" || containTheme("custom", Conf.Appearance.LightThemes) {
		t.Fatal("pending local replacement was loaded or its selection discarded")
	}
	if err = os.Remove(opPath); err != nil {
		t.Fatal(err)
	}
	writeAppearanceTestFile(t, statePath, `{"version":1,"deleted":true,"files":{}}`)
	refreshAppearanceConfig()
	if Conf.Appearance.ThemeLight != "daylight" || containTheme("custom", Conf.Appearance.LightThemes) {
		t.Fatal("deleted package with residual files did not fall back permanently")
	}
}
