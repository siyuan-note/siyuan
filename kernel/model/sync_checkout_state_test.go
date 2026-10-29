// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"
	"testing/synctest"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"github.com/olahol/melody"
	"github.com/siyuan-note/dejavu"
	"github.com/siyuan-note/dejavu/entity"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestSyncCheckoutPreparationStartsTimeoutOnlyAfterUIReady(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		task := prepareSyncCheckoutStateTest(t)
		client := addBootSyncSession(t, "loading")
		done := make(chan error, 1)
		go func() { done <- task.prepareApply() }()
		time.Sleep(20 * time.Second)
		synctest.Wait()
		if state := GetSyncCheckout("boot-sync-test", "loading").Task; state.Phase != "background" || state.Token != "" {
			t.Fatalf("save confirmation started during initialization: %+v", state)
		}
		if !dataImportAccess.TryLock() {
			t.Fatal("initialization wait holds a write lease")
		}
		dataImportAccess.Unlock()
		client.Set("uiReady", true)
		time.Sleep(time.Second)
		synctest.Wait()
		state := GetSyncCheckout("boot-sync-test", "loading").Task
		if state.Phase != "preparing" || state.Token == "" {
			t.Fatalf("ready window did not receive its own save confirmation: %+v", state)
		}
		ConfirmSyncCheckout(task.id, state.Token, true)
		if err := <-done; err != nil {
			t.Fatal(err)
		}
	})
}

func TestSyncCheckoutPreparationCanCancelWhileLoading(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		task := prepareSyncCheckoutStateTest(t)
		addBootSyncSession(t, "loading")
		done := make(chan error, 1)
		go func() { done <- task.prepareApply() }()
		synctest.Wait()
		if !CancelSyncCheckout(task.id) {
			t.Fatal("loading task could not be canceled")
		}
		if err := <-done; !errors.Is(err, context.Canceled) || task.releaseWrites != nil {
			t.Fatalf("canceled initialization entered application: %v", err)
		}
	})
}

func TestSyncCheckoutPreparationRejectsReplacedConnection(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		task := prepareSyncCheckoutStateTest(t)
		old := addBootSyncSession(t, "reconnecting")
		old.Set("uiReady", true)
		done := make(chan error, 1)
		go func() { done <- task.prepareApply() }()
		synctest.Wait()
		state := GetSyncCheckout("boot-sync-test", "reconnecting").Task
		if state.Phase != "preparing" || state.Token == "" {
			t.Fatalf("ready connection did not receive a save confirmation: %+v", state)
		}
		addBootSyncSession(t, "reconnecting")
		util.RemovePushChan(old)
		if !ConfirmSyncCheckout(task.id, state.Token, true) {
			t.Fatal("pending confirmation was unexpectedly rejected")
		}
		if err := <-done; !errors.Is(err, dejavu.ErrIndexFileChanged) || task.releaseWrites != nil {
			t.Fatalf("the previous connection's confirmation bypassed the replacement window: %v", err)
		}
	})
}

func prepareSyncCheckoutStateTest(t *testing.T) *syncCheckoutTask {
	t.Helper()
	prepareSyncDirectoryTest(t)
	previousLangs := util.Langs
	util.Langs = map[string]map[int]string{"en": {81: "Syncing", 436: "Applying synchronized changes"}}
	Conf.Lang = "en"
	ctx, cancel := context.WithCancel(context.Background())
	task := &syncCheckoutTask{id: "checkout-test", ctx: ctx, cancel: cancel, phase: "background",
		revision: syncCheckoutRevision.Add(1), upserts: map[string]*entity.File{}, removes: map[string]*entity.File{}}
	activeSyncCheckout.Lock()
	previous := activeSyncCheckout.task
	activeSyncCheckout.task = task
	activeSyncCheckout.Unlock()
	t.Cleanup(func() {
		cancel()
		if task.releaseWrites != nil {
			task.releaseWrites()
			task.releaseWrites = nil
		}
		activeSyncCheckout.Lock()
		activeSyncCheckout.task = previous
		activeSyncCheckout.Unlock()
		util.Langs = previousLangs
	})
	return task
}

func TestSyncCheckoutSnapshotKeepsMovedDocumentsAsUpserts(t *testing.T) {
	checkout := prepareSyncCheckoutStateTest(t)
	const rootID = "20261021090001-moved01"
	oldPath, newPath := "/box/"+rootID+".sy", "/box/parent/"+rootID+".sy"
	checkout.upserts[newPath] = &entity.File{Path: newPath}
	checkout.removes[oldPath] = &entity.File{Path: oldPath}
	checkout.refreshedRoots = map[string]bool{rootID: false}
	for _, phase := range []string{"applying", "background", "done"} {
		checkout.phase = phase
		state := GetSyncCheckout("", "").Task
		if !slices.Contains(state.UpsertRootIDs, rootID) || slices.Contains(state.RemoveRootIDs, rootID) {
			t.Fatalf("%s reported a moved document as removed: %+v", phase, state)
		}
	}
}

func connectSyncCheckoutClient(t *testing.T, id string) *websocket.Conn {
	t.Helper()
	push := melody.New()
	connected := make(chan *melody.Session, 1)
	push.HandleConnect(func(session *melody.Session) { util.AddPushChan(session); connected <- session })
	push.HandleDisconnect(util.RemovePushChan)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _ = push.HandleRequest(w, r) }))
	connection, response, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(server.URL, "http")+
		"/?app=checkout-test&id="+id+"&type=main", nil)
	if err != nil {
		t.Fatal(err)
	}
	_ = response.Body.Close()
	select {
	case session := <-connected:
		t.Cleanup(func() {
			util.RemovePushChan(session)
			_ = connection.Close()
			_ = push.Close()
			server.Close()
		})
	case <-time.After(5 * time.Second):
		t.Fatal("client did not register")
	}
	return connection
}

func readSyncCheckoutState(t *testing.T, connection *websocket.Conn) apicontract.SyncCheckoutState {
	t.Helper()
	_ = connection.SetReadDeadline(time.Now().Add(5 * time.Second))
	var event struct {
		Cmd  string
		Data apicontract.SyncCheckoutState
	}
	if err := connection.ReadJSON(&event); err != nil || event.Cmd != "syncProgress" {
		t.Fatalf("unexpected progress event: %+v %v", event, err)
	}
	return event.Data
}

func TestSyncCheckoutPreparationWaitsForEveryWindow(t *testing.T) {
	task := prepareSyncCheckoutStateTest(t)
	first, second := connectSyncCheckoutClient(t, "desktop"), connectSyncCheckoutClient(t, "mobile")
	if snapshot := GetSyncCheckout("checkout-test", "desktop"); snapshot.Task.Blocking || snapshot.Task.Phase != "background" {
		t.Fatalf("network stage blocks editing: %+v", snapshot)
	}
	done := make(chan error, 1)
	go func() { done <- task.prepareApply() }()
	a, b := readSyncCheckoutState(t, first), readSyncCheckoutState(t, second)
	if a.Phase != "preparing" || !a.Blocking || a.Token == "" || b.Token == "" || a.Token == b.Token {
		t.Fatalf("missing per-window preparation: %+v %+v", a, b)
	}
	if got := GetSyncCheckout("checkout-test", "desktop"); got.Task.Token != a.Token || got.Revision != a.Revision {
		t.Fatalf("reconnect snapshot lost preparation: %+v", got)
	}
	if got := GetSyncCheckout("checkout-test", "unknown"); got.Task.Token != "" {
		t.Fatal("another window's token was exposed")
	}
	if ConfirmSyncCheckout("stale", a.Token, true) || ConfirmSyncCheckout(task.id, "unknown", true) {
		t.Fatal("stale task or unknown token acknowledged")
	}
	if !ConfirmSyncCheckout(task.id, a.Token, true) || !ConfirmSyncCheckout(task.id, a.Token, false) {
		t.Fatal("acknowledgement was not idempotent")
	}
	select {
	case err := <-done:
		t.Fatalf("application began before the second window saved: %v", err)
	default:
	}
	if !ConfirmSyncCheckout(task.id, b.Token, true) {
		t.Fatal("second acknowledgement rejected")
	}
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("preparation did not finish")
	}
	if state := GetSyncCheckout("", "").Task; state.Phase != "applying" || !state.Blocking || !IsSyncCheckoutApplying() {
		t.Fatalf("local application is unprotected: %+v", state)
	}
	engine := gin.New()
	written := false
	engine.POST("/test-write", func(c *gin.Context) { c.Set(RoleContextKey, RoleAdministrator) }, CheckReadonly,
		func(c *gin.Context) { written = true; c.Status(200) })
	recorder := httptest.NewRecorder()
	engine.ServeHTTP(recorder, httptest.NewRequest("POST", "/test-write", nil))
	if written || !strings.Contains(recorder.Body.String(), "Applying synchronized changes") {
		t.Fatalf("write API passed application protection: %s", recorder.Body)
	}
	task.completeApply()
	if state := GetSyncCheckout("", "").Task; state.Blocking || state.Phase != "background" {
		t.Fatalf("upload retained application guard: %+v", state)
	}
	engine.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest("POST", "/test-write", nil))
	if !written {
		t.Fatal("write API remained blocked during upload")
	}
}

func TestSyncCheckoutPreparationRejectsUnsavedWindowAndCancellation(t *testing.T) {
	for _, cancel := range []bool{false, true} {
		t.Run(map[bool]string{false: "unsaved", true: "canceled"}[cancel], func(t *testing.T) {
			task := prepareSyncCheckoutStateTest(t)
			connection := connectSyncCheckoutClient(t, "window")
			done := make(chan error, 1)
			go func() { done <- task.prepareApply() }()
			state := readSyncCheckoutState(t, connection)
			want := dejavu.ErrIndexFileChanged
			if cancel {
				CancelSyncCheckout(task.id)
				want = context.Canceled
			} else {
				ConfirmSyncCheckout(task.id, state.Token, false)
			}
			select {
			case err := <-done:
				if !errors.Is(err, want) {
					t.Fatalf("unexpected preparation error: %v", err)
				}
			case <-time.After(5 * time.Second):
				t.Fatal("preparation did not abort")
			}
			if task.releaseWrites != nil || IsSyncCheckoutApplying() {
				t.Fatal("failed preparation entered local application")
			}
		})
	}
}

func TestSyncCheckoutPreparationRetriesWithAdmittedWrite(t *testing.T) {
	task := prepareSyncCheckoutStateTest(t)
	util.Langs["en"][239] = "Write requests are still running; retry later"
	dataImportAccess.RLock()
	err := task.prepareApply()
	dataImportAccess.RUnlock()
	if !errors.Is(err, dejavu.ErrIndexFileChanged) || task.releaseWrites != nil {
		t.Fatalf("preparation waited on a write holding the sync lock: %v", err)
	}
	if !strings.Contains(err.Error(), "Write requests are still running; retry later") {
		t.Fatalf("write contention was reported as an editor save failure: %v", err)
	}
}

func TestSyncCheckoutControllersReleaseAdmissionBeforePreparing(t *testing.T) {
	prepareSyncDirectoryTest(t)
	for _, path := range []string{"/api/sync/performSync", "/api/sync/performBootSync", "/api/notebook/enableEncryptedNotebooks"} {
		engine := gin.New()
		admitted := false
		engine.POST(path, func(c *gin.Context) { c.Set(RoleContextKey, RoleAdministrator) }, CheckReadonly, func(c *gin.Context) {
			admitted = dataImportAccess.TryLock()
			if admitted {
				dataImportAccess.Unlock()
			}
		})
		engine.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest("POST", path, nil))
		if !admitted {
			t.Fatalf("%s retained its read lease while preparing local application", path)
		}
	}
}

func TestSyncCheckoutSnapshotRetainsFinalRefreshAndFiltersIndexedPaths(t *testing.T) {
	task := prepareSyncCheckoutStateTest(t)
	const updated, removed = "20261021010101-abcdefg", "20261021010102-abcdefg"
	task.phase = "done"
	task.refreshedRoots = map[string]bool{updated: true, removed: false}
	snapshot := GetSyncCheckout("", "")
	if snapshot.KernelID != KernelID || snapshot.Task.Blocking || len(snapshot.Task.UpsertRootIDs) != 1 ||
		snapshot.Task.UpsertRootIDs[0] != updated || len(snapshot.Task.RemoveRootIDs) != 1 || snapshot.Task.RemoveRootIDs[0] != removed {
		t.Fatalf("terminal frame cannot recover a missed intermediate refresh: %+v", snapshot)
	}
	indexed, pending := &entity.File{Path: "/indexed.sy"}, &entity.File{Path: "/pending.sy"}
	task.indexedPaths = map[string]bool{indexed.Path: true}
	changes := &dejavu.MergeResult{Upserts: []*entity.File{indexed, pending}, Removes: []*entity.File{indexed}, Conflicts: []*entity.File{pending}}
	filtered := syncCheckoutUnindexed(changes)
	if len(filtered.Upserts) != 1 || filtered.Upserts[0] != pending || len(filtered.Removes) != 0 || len(filtered.Conflicts) != 1 || len(changes.Upserts) != 2 {
		t.Fatalf("indexed files reloaded or merge evidence lost: %+v", filtered)
	}
	task.cancel()
	task.phase = "background"
	if handled, err := reconcileSyncCheckoutChanges(filtered); !handled || !errors.Is(err, context.Canceled) {
		t.Fatalf("canceled preparation refreshed untouched files: %v %v", handled, err)
	}
}
