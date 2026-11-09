// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestBazaarCompatibilityFiltersPersistAndReset(t *testing.T) {
	prepareConfConsistencyTest(t)
	settingsResetTestEnvironment(t)
	for _, patch := range []string{
		`{"compatibilityFilters":{"plugins":{"hideUnsupportedVersion":true}}}`,
		`{"compatibilityFilters":{"themes":{"hideIncompatiblePlatform":true}}}`,
		`{"compatibilityFilters":{"plugins":{"hideIncompatiblePlatform":true}}}`,
	} {
		if _, err := ApplyConfPatch("bazaar", []byte(patch)); err != nil {
			t.Fatal(err)
		}
	}
	data, err := os.ReadFile(filepath.Join(util.ConfDir, "conf.json"))
	if err != nil {
		t.Fatal(err)
	}
	reloaded := NewAppConf()
	if err = json.Unmarshal(data, reloaded); err != nil {
		t.Fatal(err)
	}
	NormalizeAppConf(reloaded)
	bazaar := reloaded.Bazaar.Load()
	if !bazaar.PetalDisabled || bazaar.Trust || len(bazaar.CompatibilityFilters) != 5 ||
		!bazaar.CompatibilityFilters["plugins"].HideUnsupportedVersion || !bazaar.CompatibilityFilters["plugins"].HideIncompatiblePlatform ||
		bazaar.CompatibilityFilters["themes"].HideUnsupportedVersion || !bazaar.CompatibilityFilters["themes"].HideIncompatiblePlatform {
		t.Fatalf("persisted filters or existing flags changed: %s", data)
	}
	previous := Conf.Bazaar.Load()
	revision := BazaarPetalStateRevision.Load()
	if err = ResetSettings(); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(Conf.Bazaar.Load().CompatibilityFilters, conf.NewBazaar().CompatibilityFilters) ||
		Conf.Bazaar.Load().Trust != previous.Trust || Conf.Bazaar.Load().PetalDisabled != previous.PetalDisabled {
		t.Fatal("reset did not restore filters while preserving trust and plugin state")
	}
	if !previous.CompatibilityFilters["plugins"].HideUnsupportedVersion || !previous.CompatibilityFilters["themes"].HideIncompatiblePlatform ||
		BazaarPetalStateRevision.Load() != revision {
		t.Fatal("reset mutated the previous settings snapshot or reloaded plugins")
	}
	data, err = os.ReadFile(filepath.Join(util.ConfDir, "conf.json"))
	if err != nil {
		t.Fatal(err)
	}
	reloaded = NewAppConf()
	if err = json.Unmarshal(data, reloaded); err != nil || !reflect.DeepEqual(reloaded.Bazaar.Load(), Conf.Bazaar.Load()) {
		t.Fatalf("reset filters did not persist: %v", err)
	}
}

func TestBazaarBatchUpdateExclusionsPersistAndReset(t *testing.T) {
	prepareConfConsistencyTest(t)
	settingsResetTestEnvironment(t)
	for _, patch := range []string{
		`{"batchUpdateExcluded":{"plugins":{"sample":true}}}`,
		`{"batchUpdateExcluded":{"themes":{"sample":true,"theme":true}}}`,
		`{"compatibilityFilters":{"plugins":{"hideUnsupportedVersion":true}}}`,
	} {
		if _, err := ApplyConfPatch("bazaar", []byte(patch)); err != nil {
			t.Fatal(err)
		}
	}
	data, err := os.ReadFile(filepath.Join(util.ConfDir, "conf.json"))
	if err != nil {
		t.Fatal(err)
	}
	reloaded := NewAppConf()
	if err = json.Unmarshal(data, reloaded); err != nil {
		t.Fatal(err)
	}
	NormalizeAppConf(reloaded)
	if !reflect.DeepEqual(reloaded.Bazaar.Load().BatchUpdateExcluded["plugins"], map[string]bool{"sample": true}) || !reflect.DeepEqual(reloaded.Bazaar.Load().BatchUpdateExcluded["themes"], map[string]bool{"sample": true, "theme": true}) {
		t.Fatalf("exclusions did not persist independently: %s", data)
	}
	previous := Conf.Bazaar.Load()
	if _, err = ApplyConfPatch("bazaar", []byte(`{"batchUpdateExcluded":{"plugins":{"sample":false}}}`)); err != nil {
		t.Fatal(err)
	}
	if len(Conf.Bazaar.Load().BatchUpdateExcluded["plugins"]) != 0 || len(Conf.Bazaar.Load().BatchUpdateExcluded["themes"]) != 2 || len(previous.BatchUpdateExcluded["plugins"]) != 1 {
		t.Fatal("removing exclusion changed another type or snapshot")
	}
	if _, err = ApplyConfPatch("bazaar", []byte(`{"batchUpdateExcluded":null}`)); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(Conf.Bazaar.Load().BatchUpdateExcluded, conf.NewBazaar().BatchUpdateExcluded) {
		t.Fatal("null did not restore defaults")
	}
	if _, err = ApplyConfPatch("bazaar", []byte(`{"batchUpdateExcluded":{"widgets":{"sample":true}}}`)); err != nil {
		t.Fatal(err)
	}
	if err = ResetSettings(); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(Conf.Bazaar.Load().BatchUpdateExcluded, conf.NewBazaar().BatchUpdateExcluded) {
		t.Fatal("reset settings did not restore exclusions")
	}
}

func TestBazaarBatchUpdateExclusionsMergeIndependentWindows(t *testing.T) {
	prepareConfConsistencyTest(t)
	settingsResetTestEnvironment(t)
	// 两个窗口从相同空快照构造按包名补丁；后到的补丁不能覆盖先到的包。
	patches := []string{
		`{"batchUpdateExcluded":{"plugins":{"first":true}}}`,
		`{"batchUpdateExcluded":{"plugins":{"second":true}}}`,
		`{"batchUpdateExcluded":{"themes":{"first":true}}}`,
		`{"batchUpdateExcluded":{"plugins":{"first":false}}}`,
	}
	for _, patch := range patches {
		if _, err := ApplyConfPatch("bazaar", []byte(patch)); err != nil {
			t.Fatal(err)
		}
	}
	value := Conf.Bazaar.Load().BatchUpdateExcluded
	if value["plugins"]["first"] || !value["plugins"]["second"] || !value["themes"]["first"] {
		t.Fatalf("independent package patches lost another window's changes: %#v", value)
	}
}
