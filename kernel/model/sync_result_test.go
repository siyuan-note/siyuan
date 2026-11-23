// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestSyncResultPersistenceAndLegacyConfiguration(t *testing.T) {
	var legacy conf.Sync
	if err := json.Unmarshal([]byte(`{"enabled":true,"stat":"Localized historical message","synced":42}`), &legacy); err != nil {
		t.Fatal(err)
	}
	if legacy.LastResult != 0 || legacy.Stat != "Localized historical message" || legacy.Synced != 42 {
		t.Fatal("legacy configuration must preserve its data with an unknown result")
	}
	prepareSyncDirectoryTest(t)
	previousLangs := util.Langs
	t.Cleanup(func() { util.Langs = previousLangs })
	Conf.Lang = "en"
	util.Langs = map[string]map[int]string{"en": {80: "Sync failed: %s"}}
	readSavedSync := func() conf.Sync {
		t.Helper()
		data, err := os.ReadFile(filepath.Join(util.ConfDir, "conf.json"))
		if err != nil {
			t.Fatal(err)
		}
		var saved struct{ Sync conf.Sync }
		if err = json.Unmarshal(data, &saved); err != nil {
			t.Fatal(err)
		}
		return saved.Sync
	}
	firstErr := errors.New("sync failed before completion")
	publishSyncResult(2, firstErr)
	if state := Conf.Sync.Load(); state.LastResult != 2 || state.Synced != 0 {
		t.Fatalf("first failure recorded a success: %+v", state)
	}
	if saved := readSavedSync(); saved.LastResult != 2 || saved.Synced != 0 {
		t.Fatalf("first failure persisted an unexpected result: %+v", saved)
	}
	before := util.CurrentTimeMillis()
	publishSyncResult(1, nil)
	if state := Conf.Sync.Load(); state.LastResult != 1 {
		t.Fatalf("success result was not applied: %+v", state)
	}
	lastSuccess := Conf.Sync.Load().Synced
	if lastSuccess < before || lastSuccess > util.CurrentTimeMillis() {
		t.Fatalf("success did not record its completion time: %d", lastSuccess)
	}
	if saved := readSavedSync(); saved.LastResult != 1 || saved.Synced != lastSuccess {
		t.Fatalf("success persisted an unexpected result: %+v", saved)
	}
	UpdateSyncConf(func(s *conf.Sync) { s.Stat = "Previous success" })
	publishSyncResult(2, nil)
	if saved := readSavedSync(); saved.LastResult != 2 || saved.Synced != lastSuccess || saved.Stat != "Previous success" {
		t.Fatalf("a status-only failure changed the previous timestamp or message: %+v", saved)
	}
	publishSyncResult(2, errors.New("post-sync processing failed"))
	if state := Conf.Sync.Load(); state.Synced != lastSuccess || state.LastResult != 2 {
		t.Fatalf("a late failure changed its last successful timestamp or result: %+v", state)
	}
	if saved := readSavedSync(); saved.LastResult != 2 || saved.Synced != lastSuccess ||
		saved.Stat != "Sync failed: post-sync processing failed (Provider: S3)" {
		t.Fatalf("a late failure persisted an unexpected status: %+v", saved)
	}
}
