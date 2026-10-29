// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build darwin

package model

import (
	"testing"

	"github.com/radovskyb/watcher"
)

func TestAssetWatcherDarwinEventBatch(t *testing.T) {
	for _, op := range []watcher.Op{watcher.Create, watcher.Write, watcher.Remove} {
		t.Run(op.String(), func(t *testing.T) {
			batch := assetWatchBatch{}
			batch.addDarwinEvent(watcher.Event{Path: "asset", Op: op})
			if len(batch) != 1 || !batch["asset"] {
				t.Fatalf("content event did not retain its sync trigger: %v", batch)
			}
		})
	}
	for _, op := range []watcher.Op{watcher.Rename, watcher.Move} {
		t.Run(op.String(), func(t *testing.T) {
			batch := assetWatchBatch{}
			batch.addDarwinEvent(watcher.Event{OldPath: "old", Path: "new", Op: op})
			if len(batch) != 2 || !batch["old"] || !batch["new"] {
				t.Fatalf("renamed resource lost a path: %v", batch)
			}
		})
	}
	batch := assetWatchBatch{}
	batch.addDarwinEvent(watcher.Event{Path: "metadata", Op: watcher.Chmod})
	if changed, exists := batch["metadata"]; !exists || changed {
		t.Fatalf("metadata-only event changed sync scheduling: %v", batch)
	}
	batch.addDarwinEvent(watcher.Event{Path: "asset", Op: watcher.Write})
	batch.addDarwinEvent(watcher.Event{Path: "asset", Op: watcher.Chmod})
	if !batch["asset"] {
		t.Fatal("metadata change discarded a content change")
	}
}
