// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build !darwin

package model

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
	"testing/synctest"
	"time"

	"github.com/fsnotify/fsnotify"
)

func TestAssetWatcherRecoveryRebindsRoot(t *testing.T) {
	base := t.TempDir()
	root := filepath.Join(base, "assets")
	if err := os.Mkdir(root, 0755); err != nil {
		t.Fatal(err)
	}
	old := filepath.Join(root, "removed.txt")
	if err := os.WriteFile(old, []byte("old"), 0644); err != nil {
		t.Fatal(err)
	}
	watcher, err := fsnotify.NewBufferedWatcher(128)
	if err != nil {
		t.Fatal(err)
	}
	defer watcher.Close()
	if err = watcher.Add(root); err != nil {
		t.Fatal(err)
	}
	state := newAssetWatchRecovery(watcher, root)
	if err = os.Rename(root, filepath.Join(base, "retired")); err != nil {
		t.Fatal(err)
	}
	if _, err = state.recover(false); !os.IsNotExist(err) || !state.known[old] {
		t.Fatalf("missing root lost reconciliation state: %v %v", state.known, err)
	}
	if err = os.Mkdir(root, 0755); err != nil {
		t.Fatal(err)
	}
	current := filepath.Join(root, "current.txt")
	if err = os.WriteFile(current, []byte("new"), 0644); err != nil {
		t.Fatal(err)
	}
	batch, err := state.recover(false)
	if err != nil || !batch[old] || !batch[current] {
		t.Fatalf("replacement not reconciled: %v %v", batch, err)
	}
	newFile := filepath.Join(root, "later.txt")
	if err = os.WriteFile(newFile, []byte("later"), 0644); err != nil {
		t.Fatal(err)
	}
	timer := time.NewTimer(5 * time.Second)
	defer timer.Stop()
	for {
		select {
		case event := <-watcher.Events:
			if event.Name == newFile && event.Has(fsnotify.Create) {
				return
			}
		case err := <-watcher.Errors:
			t.Fatal(err)
		case <-timer.C:
			t.Fatal("replacement root was not watched")
		}
	}
}

func TestAssetWatcherOverflowReconcilesAllKnownPaths(t *testing.T) {
	root := t.TempDir()
	old := filepath.Join(root, "removed.txt")
	if err := os.WriteFile(old, []byte("old"), 0644); err != nil {
		t.Fatal(err)
	}
	watcher, err := fsnotify.NewBufferedWatcher(128)
	if err != nil {
		t.Fatal(err)
	}
	defer watcher.Close()
	if err = watcher.Add(root); err != nil {
		t.Fatal(err)
	}
	state := newAssetWatchRecovery(watcher, root)
	if err = os.Remove(old); err != nil {
		t.Fatal(err)
	}
	current := filepath.Join(root, "new.txt")
	if err = os.WriteFile(current, []byte("new"), 0644); err != nil {
		t.Fatal(err)
	}
	batch, err := state.recover(true)
	if err != nil || !batch[old] || !batch[current] {
		t.Fatalf("overflow missed paths: %v %v", batch, err)
	}
	if batch, err = state.recover(false); err != nil || batch != nil {
		t.Fatalf("unchanged root rescanned: %v %v", batch, err)
	}
}

func TestAssetWatcherOverflowRoutesToRecovery(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		events, watchErrors := make(chan fsnotify.Event), make(chan error)
		var batches []assetWatchBatch
		overflows := 0
		go processAssetWatchEventsWithRecovery(events, watchErrors,
			func(batch assetWatchBatch) { batches = append(batches, batch) },
			func(overflow bool) (assetWatchBatch, error) {
				if overflow {
					overflows++
					return assetWatchBatch{"lost.txt": true}, nil
				}
				return nil, nil
			})
		watchErrors <- errors.New("other error")
		synctest.Wait()
		if overflows != 0 || len(batches) != 0 {
			t.Fatal("ordinary error triggered overflow recovery")
		}
		events <- fsnotify.Event{Name: "queued.txt", Op: fsnotify.Write}
		watchErrors <- fsnotify.ErrEventOverflow
		synctest.Wait()
		if overflows != 1 || len(batches) != 1 || !batches[0]["lost.txt"] || !batches[0]["queued.txt"] {
			t.Fatalf("overflow did not flush queued and recovered paths: %v", batches)
		}
		close(events)
		synctest.Wait()
	})
}
