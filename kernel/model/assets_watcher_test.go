// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build !darwin

package model

import (
	"testing"
	"testing/synctest"
	"time"

	"github.com/fsnotify/fsnotify"
)

func TestAssetWatcherEventBatch(t *testing.T) {
	for _, op := range []fsnotify.Op{fsnotify.Create, fsnotify.Write, fsnotify.Rename, fsnotify.Remove,
		fsnotify.Write | fsnotify.Remove, fsnotify.Create | fsnotify.Chmod} {
		t.Run(op.String(), func(t *testing.T) {
			batch := assetWatchBatch{}
			batch.addFSNotifyEvent(fsnotify.Event{Name: "asset", Op: op})
			if len(batch) != 1 || !batch["asset"] {
				t.Fatalf("content event did not retain its sync trigger: %v", batch)
			}
		})
	}
	batch := assetWatchBatch{}
	batch.addFSNotifyEvent(fsnotify.Event{Name: "metadata", Op: fsnotify.Chmod})
	if changed, exists := batch["metadata"]; !exists || changed {
		t.Fatalf("metadata-only event changed sync scheduling: %v", batch)
	}
	batch.addFSNotifyEvent(fsnotify.Event{Name: "first", Op: fsnotify.Write})
	batch.addFSNotifyEvent(fsnotify.Event{Name: "first", Op: fsnotify.Chmod})
	batch.addFSNotifyEvent(fsnotify.Event{Name: "second", Op: fsnotify.Remove})
	if len(batch) != 3 || !batch["first"] || !batch["second"] {
		t.Fatalf("later events discarded an earlier path or sync trigger: %v", batch)
	}
}

func TestAssetWatcherFlushesContinuousEvents(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		events := make(chan fsnotify.Event)
		errors := make(chan error)
		var batches []assetWatchBatch
		go processAssetWatchEvents(events, errors, func(batch assetWatchBatch) { batches = append(batches, batch) })
		events <- fsnotify.Event{Name: "saved.pdf", Op: fsnotify.Write}
		for i := 0; i < 61; i++ {
			time.Sleep(50 * time.Millisecond)
			events <- fsnotify.Event{Name: ".continuous.tmp", Op: fsnotify.Write}
			synctest.Wait()
			if i == 20 && (len(batches) == 0 || !batches[0]["saved.pdf"]) {
				t.Fatal("continuous temporary events postponed a saved asset beyond one second")
			}
		}
		if len(batches) < 3 {
			t.Fatalf("continuous events did not flush periodically: %d", len(batches))
		}
		time.Sleep(101 * time.Millisecond)
		synctest.Wait()
		if len(batches) != 4 {
			t.Fatalf("final idle batch was not flushed: %d", len(batches))
		}
		close(events)
		synctest.Wait()
	})
}

func TestAssetWatcherDebouncesShortBurst(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		events := make(chan fsnotify.Event)
		var batches []assetWatchBatch
		go processAssetWatchEvents(events, nil, func(batch assetWatchBatch) { batches = append(batches, batch) })
		events <- fsnotify.Event{Name: "first", Op: fsnotify.Write}
		time.Sleep(70 * time.Millisecond)
		events <- fsnotify.Event{Name: "second", Op: fsnotify.Create}
		time.Sleep(70 * time.Millisecond)
		synctest.Wait()
		if len(batches) != 0 {
			t.Fatal("short burst was flushed before it became idle")
		}
		time.Sleep(31 * time.Millisecond)
		synctest.Wait()
		if len(batches) != 1 || !batches[0]["first"] || !batches[0]["second"] {
			t.Fatalf("short burst was not coalesced: %v", batches)
		}
		close(events)
		synctest.Wait()
	})
}
