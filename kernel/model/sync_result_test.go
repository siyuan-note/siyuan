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
	for _, result := range []int{2, 1, 2} {
		publishSyncResult(result, nil)
		if Conf.Sync.Load().LastResult != result {
			t.Fatal("completed result was not applied")
		}
		data, err := os.ReadFile(filepath.Join(util.ConfDir, "conf.json"))
		if err != nil {
			t.Fatal(err)
		}
		var saved struct{ Sync conf.Sync }
		if err = json.Unmarshal(data, &saved); err != nil || saved.Sync.LastResult != result {
			t.Fatalf("result was not persisted for restart: %v", err)
		}
	}
	UpdateSyncConf(func(s *conf.Sync) { s.Stat = "Previous success" })
	publishSyncResult(2, errors.New("post-sync processing failed"))
	data, err := os.ReadFile(filepath.Join(util.ConfDir, "conf.json"))
	if err != nil {
		t.Fatal(err)
	}
	var saved struct{ Sync conf.Sync }
	if err = json.Unmarshal(data, &saved); err != nil || saved.Sync.LastResult != 2 ||
		saved.Sync.Stat != "Sync failed: post-sync processing failed (Provider: S3)" {
		t.Fatalf("a late failure must persist its own message and result: %v, %+v", err, saved.Sync)
	}
}
