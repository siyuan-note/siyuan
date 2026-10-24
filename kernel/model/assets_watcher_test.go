//go:build !darwin

package model

import (
	"testing"

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
