// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestDynamicRefTextRetryJournalPreservesUnsupportedData(t *testing.T) {
	previousDir := util.QueueDir
	previousPending, previousLoaded := dynamicRefTextRetries.pending, dynamicRefTextRetries.loadedPath
	util.QueueDir = t.TempDir()
	t.Cleanup(func() {
		util.QueueDir = previousDir
		dynamicRefTextRetries.pending, dynamicRefTextRetries.loadedPath = previousPending, previousLoaded
	})
	filename := filepath.Join(util.QueueDir, "ref-text-retry.json")
	for _, data := range []string{`{"spec":2,"pending":[]}`, `{"spec":1,"pending":[`, `{}`,
		`{"spec":1,"pending":[{"box":"invalid","id":"invalid"}]}`} {
		if err := os.WriteFile(filename, []byte(data), 0644); err != nil {
			t.Fatal(err)
		}
		dynamicRefTextRetries.pending = map[dynamicRefTextRetryKey]time.Time{}
		dynamicRefTextRetries.loadedPath = ""
		if err := loadDynamicRefTextRetriesLocked(); err == nil {
			t.Fatalf("unsupported retry journal accepted: %s", data)
		}
		if err := saveDynamicRefTextRetriesLocked(); err == nil {
			t.Fatalf("unsupported retry journal was overwritten: %s", data)
		}
		if after, err := os.ReadFile(filename); err != nil || !bytes.Equal(after, []byte(data)) {
			t.Fatalf("unsupported retry journal changed: %s, %v", after, err)
		}
	}
}
