package model

import (
	"reflect"
	"sync"
	"testing"
	"testing/synctest"
	"time"
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
