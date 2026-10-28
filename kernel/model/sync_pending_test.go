// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"os"
	"path/filepath"
	"reflect"
	"sync"
	"testing"
	"testing/synctest"
	"time"

	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestSyncPendingCoalescesChanges(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		var state syncPendingState
		var notifications []bool
		notify := func(pending bool) { notifications = append(notifications, pending) }
		for range 100 {
			state.change(notify)
		}
		time.Sleep(101 * time.Millisecond)
		synctest.Wait()
		if !reflect.DeepEqual(notifications, []bool{true}) {
			t.Fatalf("notifications = %v", notifications)
		}
		state.change(notify)
		time.Sleep(101 * time.Millisecond)
		synctest.Wait()
		if !reflect.DeepEqual(notifications, []bool{true, true}) {
			t.Fatalf("subsequent changes must notify again: %v", notifications)
		}
	})
}

func TestSyncPendingDownloadToEmptyRemote(t *testing.T) {
	prepareAssetDownloadRepoTest(t)
	if err := ensureAllSyncAssets(); err != nil {
		t.Fatal(err)
	}
	remote := Conf.Sync.Load().Local.Endpoint
	if err := os.Rename(filepath.Join(remote, "main"), filepath.Join(remote, "saved")); err != nil {
		t.Fatal(err)
	}
	Conf.Sync.Load().AssetDownloadMode = 0
	Conf.Lang = "en"
	previousLangs := util.Langs
	util.Langs = map[string]map[int]string{"en": {150: "%d %d %d %d %s %s"}}
	t.Cleanup(func() { util.Langs = previousLangs })
	Conf.Editor.Store(conf.NewEditor())
	file := filepath.Join(util.DataDir, "local.txt")
	if err := os.WriteFile(file, []byte("not uploaded"), 0644); err != nil {
		t.Fatal(err)
	}
	pendingSync.mu.Lock()
	previousPending := pendingSync.pending
	pendingSync.pending = true
	pendingSync.mu.Unlock()
	t.Cleanup(func() {
		pendingSync.mu.Lock()
		pendingSync.pending = previousPending
		pendingSync.mu.Unlock()
	})
	lockSync()
	err := syncDataDownloadLocked()
	unlockSync()
	if err != nil {
		t.Fatal(err)
	}
	pendingSync.mu.Lock()
	pending := pendingSync.pending
	pendingSync.mu.Unlock()
	if !pending {
		t.Fatal("download-only sync cleared unpublished local changes")
	}
	if data, err := os.ReadFile(file); err != nil || string(data) != "not uploaded" {
		t.Fatalf("download changed local data: %q %v", data, err)
	}
	if _, err := os.Stat(filepath.Join(Conf.Sync.Load().Local.Endpoint, "main", "refs", "latest")); !os.IsNotExist(err) {
		t.Fatalf("download published local changes: %v", err)
	}
}

func TestSyncPendingCompletion(t *testing.T) {
	for _, test := range []struct {
		name    string
		success bool
		changed bool
		pending bool
	}{
		{"success", true, false, false},
		{"failure", false, false, true},
		{"change during success", true, true, true},
		{"change during failure", false, true, true},
	} {
		t.Run(test.name, func(t *testing.T) {
			synctest.Test(t, func(t *testing.T) {
				var state syncPendingState
				var notifications []bool
				notify := func(pending bool) { notifications = append(notifications, pending) }
				state.change(notify)
				revision := state.begin()
				if test.changed {
					state.change(notify)
				}
				state.finish(revision, test.success, notify)
				time.Sleep(101 * time.Millisecond)
				synctest.Wait()
				for _, pending := range notifications {
					if pending != test.pending {
						t.Fatalf("completion or delayed notification = %v, want %v", notifications, test.pending)
					}
				}
				state.finish(state.begin(), true, notify)
				if notifications[len(notifications)-1] {
					t.Fatal("next successful sync must clear pending changes")
				}
			})
		})
	}
}

func TestSyncPendingConcurrentChanges(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		var state syncPendingState
		notify := func(bool) {}
		revision := state.begin()
		var workers sync.WaitGroup
		for range 100 {
			workers.Go(func() { state.change(notify) })
		}
		workers.Wait()
		state.finish(revision, true, func(pending bool) {
			if !pending {
				t.Fatal("concurrent changes must remain pending")
			}
		})
		time.Sleep(101 * time.Millisecond)
		synctest.Wait()
	})
}

func TestSyncPendingFailurePreservesFrontendHint(t *testing.T) {
	var state syncPendingState
	state.finish(state.begin(), false, func(bool) {
		t.Fatal("failed sync must not overwrite the frontend hint")
	})
}

func TestSyncPendingChangeAfterCompletion(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		var state syncPendingState
		var notifications []bool
		notify := func(pending bool) { notifications = append(notifications, pending) }
		state.change(notify)
		state.finish(state.begin(), true, notify)
		state.change(notify)
		time.Sleep(101 * time.Millisecond)
		synctest.Wait()
		if !reflect.DeepEqual(notifications, []bool{false, true}) {
			t.Fatalf("new changes after completion must restore the hint: %v", notifications)
		}
	})
}
