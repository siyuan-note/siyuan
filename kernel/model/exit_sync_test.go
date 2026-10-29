// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestExitSyncPreservesExistingPerceptionNotification(t *testing.T) {
	previousConf, previousConnection := Conf, webSocketConn
	Conf = NewAppConf()
	Conf.Sync.Store(conf.NewSync())
	Conf.Sync.Load().Mode, Conf.Sync.Load().Perception = 1, true
	t.Cleanup(func() { Conf, webSocketConn = previousConf, previousConnection })
	notified := make(chan string, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		connection, err := (&websocket.Upgrader{}).Upgrade(w, r, nil)
		if err != nil {
			t.Error(err)
			return
		}
		defer connection.Close()
		var message struct {
			Cmd string `json:"cmd"`
		}
		if err = connection.ReadJSON(&message); err != nil {
			t.Error(err)
			return
		}
		notified <- message.Cmd
	}))
	defer server.Close()
	connection, _, err := websocket.DefaultDialer.Dial("ws"+server.URL[len("http"):], nil)
	if err != nil {
		t.Fatal(err)
	}
	defer connection.Close()
	webSocketConn = connection
	finishSyncPerception(true, nil, false)
	select {
	case command := <-notified:
		if command != "synced" {
			t.Fatal(command)
		}
	case <-time.After(time.Second):
		t.Fatal("exit stopped notifying other devices")
	}
}

func TestExitSyncCancellationPreservesLocalData(t *testing.T) {
	prepareSyncDirectoryTest(t)
	previousStatus := util.StatusBarCfg.Load()
	util.StatusBarCfg.Store(&util.StatusBar{MsgDataSyncDisabled: true})
	t.Cleanup(func() { util.StatusBarCfg.Store(previousStatus) })
	Conf.Sync.Load().Enabled = true
	Conf.Sync.Load().Perception = false
	Conf.Sync.Load().CloudName = "main"
	Conf.SetUser(&conf.User{UserId: "exit-test", UserSiYuanOneTimePayStatus: 1})
	if err := os.MkdirAll(util.DataDir, 0755); err != nil {
		t.Fatal(err)
	}
	filename := filepath.Join(util.DataDir, "offline.txt")
	if err := os.WriteFile(filename, []byte("unsynced local content"), 0644); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	requested := make(chan struct{}, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case requested <- struct{}{}:
		default:
		}
		<-r.Context().Done()
	}))
	defer server.Close()
	Conf.Sync.Load().S3.Endpoint = server.URL
	previousErrors, previousResult := autoSyncErrCount.Load(), BootSyncSucc.Load()
	previousDNS := lastDNSFlushTime
	pendingSync.mu.Lock()
	previousPending := pendingSync.pending
	pendingSync.pending = true
	pendingSync.mu.Unlock()
	t.Cleanup(func() {
		autoSyncErrCount.Store(previousErrors)
		BootSyncSucc.Store(previousResult)
		lastDNSFlushTime = previousDNS
		pendingSync.mu.Lock()
		pendingSync.pending = previousPending
		pendingSync.mu.Unlock()
	})
	BootSyncSucc.Store(-1)
	done := make(chan error, 1)
	go func() {
		lockSync()
		err := syncDataLockedContext(ctx, true, false)
		unlockSync()
		done <- err
	}()
	select {
	case <-requested:
	case err := <-done:
		t.Fatalf("sync ended before reaching the network: %v", err)
	case <-time.After(10 * time.Second):
		t.Fatal("exit sync never reached the network")
	}
	cancel()
	select {
	case err := <-done:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("cancellation lost: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("canceled exit sync kept waiting for the network")
	}
	if !syncLock.TryLock() {
		t.Fatal("exit sync retained the repository lock")
	}
	syncLock.Unlock()
	data, err := os.ReadFile(filename)
	if err != nil || string(data) != "unsynced local content" {
		t.Fatalf("local data changed: %q (%v)", data, err)
	}
	if !pendingSync.pending || BootSyncSucc.Load() != -1 || !lastDNSFlushTime.Equal(previousDNS) {
		t.Fatal("cancellation cleared pending data, reported successful sync or retried DNS")
	}
}

func TestExitSyncLockCancellationAndSafeForce(t *testing.T) {
	for _, force := range []bool{false, true} {
		t.Run(map[bool]string{false: "wait", true: "force"}[force], func(t *testing.T) {
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			lockSync()
			locked := true
			defer func() {
				if locked {
					unlockSync()
				}
			}()
			activeCtx, cancelActive := context.WithCancel(context.Background())
			defer cancelActive()
			previous := activeSyncCheckout.task
			activeSyncCheckout.task = &syncCheckoutTask{cancel: cancelActive}
			t.Cleanup(func() { activeSyncCheckout.task = previous })
			done := make(chan error, 1)
			go func() { done <- lockSyncForExit(ctx, force) }()
			if !force {
				cancel()
				if err := <-done; !errors.Is(err, context.Canceled) {
					t.Fatal(err)
				}
				if activeCtx.Err() != nil {
					t.Fatal("ordinary exit canceled another sync")
				}
				return
			}
			select {
			case <-activeCtx.Done():
			case <-time.After(time.Second):
				t.Fatal("force did not cancel active sync")
			}
			select {
			case <-done:
				t.Fatal("force cleanup started before active sync finished")
			default:
			}
			unlockSync()
			locked = false
			select {
			case err := <-done:
				if err != nil {
					t.Fatal(err)
				}
				unlockSync()
			case <-time.After(time.Second):
				t.Fatal("force did not acquire the finished sync lock")
			}
		})
	}
}

func TestExitSyncRejectsQueuedWorkAfterCleanup(t *testing.T) {
	previous := util.IsExiting.Swap(true)
	t.Cleanup(func() { util.IsExiting.Store(previous) })
	if checkSync(true, false, false) || checkSync(false, true, true) {
		t.Fatal("sync was admitted after cleanup")
	}
	if unlock, ok := lockSyncRequest(&syncRequestState{}); ok {
		unlock()
		t.Fatal("queued sync acquired closed workspace")
	}
}

func TestExitSyncCancelsUploadOnlyBeforeCleanup(t *testing.T) {
	for _, mode := range []string{"exit", "manual"} {
		t.Run(mode, func(t *testing.T) {
			prepareSyncDirectoryTest(t)
			previousStatus := util.StatusBarCfg.Load()
			util.StatusBarCfg.Store(&util.StatusBar{MsgDataSyncDisabled: true})
			t.Cleanup(func() { util.StatusBarCfg.Store(previousStatus) })
			Conf.Sync.Load().Enabled, Conf.Sync.Load().Perception = true, false
			Conf.Sync.Load().CloudName = "main"
			Conf.SetUser(&conf.User{UserId: "upload-exit-test", UserSiYuanOneTimePayStatus: 1})
			previousResult, previousErrors := BootSyncSucc.Load(), autoSyncErrCount.Load()
			BootSyncSucc.Store(-1)
			t.Cleanup(func() {
				BootSyncSucc.Store(previousResult)
				autoSyncErrCount.Store(previousErrors)
			})
			if err := os.MkdirAll(util.DataDir, 0755); err != nil {
				t.Fatal(err)
			}
			filename := filepath.Join(util.DataDir, "offline-upload.txt")
			if err := os.WriteFile(filename, []byte("unsynced upload"), 0644); err != nil {
				t.Fatal(err)
			}
			started, canceled := make(chan struct{}, 1), make(chan struct{}, 1)
			release := make(chan struct{})
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				select {
				case started <- struct{}{}:
				default:
				}
				select {
				case <-r.Context().Done():
					select {
					case canceled <- struct{}{}:
					default:
					}
				case <-release:
					w.WriteHeader(http.StatusForbidden)
				}
			}))
			defer server.Close()
			defer server.CloseClientConnections()
			Conf.Sync.Load().S3.Endpoint = server.URL
			done, finished := make(chan error, 1), make(chan struct{})
			go func() {
				defer close(finished)
				done <- SyncDataUpload()
			}()
			defer func() {
				close(release)
				if task := GetSyncCheckout("", "").Task; task != nil {
					CancelSyncCheckout(task.TaskID)
				}
				select {
				case <-finished:
				case <-time.After(5 * time.Second):
					t.Error("upload task did not finish during test cleanup")
				}
			}()
			select {
			case <-started:
			case err := <-done:
				t.Fatalf("upload did not reach the cloud: %v", err)
			case <-time.After(5 * time.Second):
				t.Fatal("upload did not start")
			}
			snapshot := GetSyncCheckout("", "")
			if snapshot.Task == nil || snapshot.Task.Blocking {
				t.Fatal("upload-only did not register a cancellable background task")
			}
			if mode == "manual" {
				if !CancelSyncCheckout(snapshot.Task.TaskID) {
					t.Fatal("upload cancellation was rejected")
				}
			} else {
				ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
				defer cancel()
				if err := lockSyncForExit(ctx, true); err != nil {
					t.Fatalf("force exit could not cancel upload: %v", err)
				}
				defer unlockSync()
			}
			select {
			case err := <-done:
				if !errors.Is(err, context.Canceled) {
					t.Fatalf("upload cancellation was lost: %v", err)
				}
			case <-time.After(5 * time.Second):
				t.Fatal("canceled upload did not finish")
			}
			select {
			case <-canceled:
			case <-time.After(time.Second):
				t.Fatal("cloud request outlived the canceled upload task")
			}
			if GetSyncCheckout("", "").Task != nil || BootSyncSucc.Load() != -1 {
				t.Fatal("canceled upload retained its task or reported successful synchronization")
			}
			data, err := os.ReadFile(filename)
			if err != nil || string(data) != "unsynced upload" {
				t.Fatalf("local changes were not preserved: %q (%v)", data, err)
			}
		})
	}
}
