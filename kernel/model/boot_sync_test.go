// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"testing/synctest"
	"time"

	"github.com/gorilla/websocket"
	"github.com/olahol/melody"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func addBootSyncSession(t *testing.T, id string) *melody.Session {
	t.Helper()
	session := &melody.Session{Request: httptest.NewRequest("GET", "/ws?app=boot-sync-test&id="+id+"&type=main&ready=false", nil)}
	util.AddPushChan(session)
	t.Cleanup(func() { util.RemovePushChan(session) })
	return session
}

func TestBootSyncUnreachableCloudDoesNotBlockLocalStartup(t *testing.T) {
	const childEnv = "SIYUAN_TEST_OFFLINE_BOOT"
	if os.Getenv(childEnv) == "" {
		cmd := exec.Command(os.Args[0], "-test.run=^TestBootSyncUnreachableCloudDoesNotBlockLocalStartup$", "-test.timeout=30s")
		cmd.Env = append(os.Environ(), childEnv+"=1")
		if output, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("isolated offline startup failed: %v\n%s", err, output)
		}
		return
	}
	prepareSyncDirectoryTest(t)
	util.StatusBarCfg.Store(&util.StatusBar{MsgDataSyncDisabled: true})
	util.AttachUI = true
	Conf.Sync.Load().Enabled = true
	Conf.Sync.Load().Perception = false
	Conf.Sync.Load().CloudName = "main"
	Conf.SetUser(&conf.User{UserId: "offline-test", UserSiYuanOneTimePayStatus: 1})
	requested := make(chan struct{}, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !util.IsBooted() {
			t.Error("network request blocked local startup")
		}
		select {
		case requested <- struct{}{}:
		default:
		}
		<-r.Context().Done()
	}))
	t.Cleanup(func() { server.CloseClientConnections(); server.Close() })
	Conf.Sync.Load().S3.Endpoint = server.URL
	BootSyncData()
	if !bootSyncScheduled.Load() || isSyncingStorages() {
		t.Fatal("offline boot did not defer synchronization")
	}
	select {
	case <-requested:
		t.Fatal("cloud request started before local startup")
	default:
	}
	util.SetBooted()
	acknowledgeBootSyncClient(t, "offline-ready")
	select {
	case <-requested:
	case <-time.After(5 * time.Second):
		t.Fatal("background synchronization did not start")
	}
	snapshot := GetSyncCheckout("", "")
	if snapshot.Task == nil || !CancelSyncCheckout(snapshot.Task.TaskID) {
		t.Fatal("offline background sync could not be canceled")
	}
	deadline := time.Now().Add(5 * time.Second)
	for bootSyncScheduled.Load() && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if bootSyncScheduled.Load() || BootSyncSucc.Load() != 1 {
		t.Fatal("canceled offline boot sync did not finish as unsuccessful")
	}
}

func TestBootSyncUIWaitSurvivesSlowStartupAndRefresh(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		first := addBootSyncSession(t, "first")
		ctx, cancel := context.WithCancel(context.Background())
		defer cancel()
		done := make(chan error, 1)
		go func() { done <- waitForSyncUI(ctx, true, false) }()
		time.Sleep(20 * time.Second)
		synctest.Wait()
		select {
		case err := <-done:
			t.Fatalf("slow initialization ended the readiness wait: %v", err)
		default:
		}
		for _, id := range []string{"first", "refresh-1", "refresh-2", "refresh-3"} {
			previous := first
			first = addBootSyncSession(t, id)
			util.RemovePushChan(previous)
			time.Sleep(time.Second)
			if syncUIReady(false) {
				t.Fatal("late disconnect hid the loading replacement connection")
			}
		}
		first.Set("uiReady", true)
		time.Sleep(time.Second)
		if err := <-done; err != nil {
			t.Fatal(err)
		}
	})
}

func TestBootSyncUIWaitHeadlessAndCancellation(t *testing.T) {
	if err := waitForSyncUI(context.Background(), false, false); err != nil {
		t.Fatal(err)
	}
	synctest.Test(t, func(t *testing.T) {
		addBootSyncSession(t, "loading")
		ctx, cancel := context.WithCancel(context.Background())
		done := make(chan error, 1)
		go func() { done <- waitForSyncUI(ctx, false, false) }()
		synctest.Wait()
		cancel()
		if err := <-done; !errors.Is(err, context.Canceled) {
			t.Fatalf("cancellation did not interrupt initialization wait: %v", err)
		}
	})
}

func acknowledgeBootSyncClient(t *testing.T, id string) {
	t.Helper()
	connection := connectSyncCheckoutClient(t, id)
	done := make(chan struct{})
	go func() {
		defer close(done)
		for {
			var event struct {
				Cmd  string
				Data json.RawMessage
			}
			if connection.ReadJSON(&event) != nil {
				return
			}
			if event.Cmd == "syncProgress" {
				var state apicontract.SyncCheckoutState
				if json.Unmarshal(event.Data, &state) == nil && state.Phase == "preparing" {
					ConfirmSyncCheckout(state.TaskID, state.Token, true)
				}
			}
		}
	}()
	t.Cleanup(func() { connection.Close(); <-done })
}

func TestBootSyncStartupLifecycle(t *testing.T) {
	const childEnv = "SIYUAN_TEST_BOOT_SYNC_STARTUP"
	mode := os.Getenv(childEnv)
	if mode == "" {
		for _, mode := range []string{"desktop", "android", "ios", "harmony", "headless", "disabled", "source-changed", "reopen-failed"} {
			t.Run(mode, func(t *testing.T) {
				cmd := exec.Command(os.Args[0], "-test.run=^TestBootSyncStartupLifecycle$", "-test.timeout=30s")
				cmd.Env = append(os.Environ(), childEnv+"="+mode)
				if output, err := cmd.CombinedOutput(); err != nil {
					t.Fatalf("boot sync subprocess failed: %v\n%s", err, output)
				}
			})
		}
		return
	}
	full, _, fullData := prepareAssetDownloadRepoTest(t)
	Conf.NotebookCrypto = conf.NewNotebookCrypto()
	Conf.Sync.Load().Perception = false
	lastAutoPurgeRepo = time.Now()
	getPetals()
	if err := os.MkdirAll(filepath.Join(fullData, "storage"), 0755); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"remote.txt", "storage/boot-test.json"} {
		if err := os.WriteFile(filepath.Join(fullData, filepath.FromSlash(name)), []byte(`{"synced":true}`), 0644); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := full.Index("remote startup changes", true, nil); err != nil {
		t.Fatal(err)
	}
	if _, _, err := full.Sync(nil); err != nil {
		t.Fatal(err)
	}
	native := mode == "desktop" || mode == "android" || mode == "ios" || mode == "harmony"
	util.AttachUI = mode == "desktop"
	if native && mode != "desktop" {
		util.Container = mode
	}
	var loading *melody.Session
	if native {
		loading = addBootSyncSession(t, "loading")
	}
	BootSyncData()
	if native {
		BootSyncData()
		if !bootSyncScheduled.Load() || checkSync(false, false, false) {
			t.Fatal("startup was not deferred or automatic sync bypassed readiness")
		}
	}
	if BootSyncSucc.Load() != -1 || isSyncingStorages() {
		t.Fatal("pending startup reported success or blocked storage initialization")
	}
	if _, err := os.Stat(filepath.Join(util.DataDir, "remote.txt")); !os.IsNotExist(err) {
		t.Fatalf("cloud changes applied before local boot: %v", err)
	}
	if mode == "disabled" {
		Conf.Sync.Load().Enabled = false
	} else if mode == "source-changed" {
		Conf.Sync.Load().CloudName = "different"
	} else if mode == "reopen-failed" {
		// 保留同步源身份，只破坏仓库目录，覆盖重开失败后的任务收尾。
		if err := os.RemoveAll(util.RepoDir); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(util.RepoDir, []byte("not a directory"), 0644); err != nil {
			t.Fatal(err)
		}
	}
	util.SetBooted()
	if native {
		for i := range 3 {
			util.RemovePushChan(loading)
			loading = addBootSyncSession(t, fmt.Sprintf("refresh-%d", i))
			time.Sleep(120 * time.Millisecond)
			if BootSyncSucc.Load() != -1 || isSyncingStorages() {
				t.Fatal("loading-page refresh started sync or blocked storage reads")
			}
		}
		acknowledgeBootSyncClient(t, "ready")
		util.RemovePushChan(loading)
	}
	deadline := time.Now().Add(10 * time.Second)
	for (BootSyncSucc.Load() == -1 || bootSyncScheduled.Load()) && time.Now().Before(deadline) {
		time.Sleep(20 * time.Millisecond)
	}
	want := int32(0)
	if mode == "disabled" || mode == "source-changed" || mode == "reopen-failed" {
		want = 1
	}
	if BootSyncSucc.Load() != want || bootSyncScheduled.Load() || isSyncingStorages() {
		t.Fatalf("startup did not finish cleanly: result=%d scheduled=%t storage=%t", BootSyncSucc.Load(), bootSyncScheduled.Load(), isSyncingStorages())
	}
	if want == 0 {
		data, err := os.ReadFile(filepath.Join(util.DataDir, "remote.txt"))
		if err != nil || string(data) != `{"synced":true}` {
			t.Fatalf("ready startup failed to apply cloud changes: %q %v", data, err)
		}
	}
}

func TestIOSBootSyncPerception(t *testing.T) {
	// 启动状态和同步后的后台任务属于进程状态，使用子进程隔离其他测试。
	const childEnv = "SIYUAN_TEST_IOS_BOOT_SYNC"
	if os.Getenv(childEnv) == "" {
		cmd := exec.Command(os.Args[0], "-test.run=^TestIOSBootSyncPerception$", "-test.timeout=60s")
		cmd.Env = append(os.Environ(), childEnv+"=1")
		if output, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("iOS boot sync subprocess failed: %v\n%s", err, output)
		}
		return
	}

	full, _, _ := prepareAssetDownloadRepoTest(t)
	util.Container = util.ContainerIOS
	util.SetBooted()
	util.IsUILoaded.Store(true)
	acknowledgeBootSyncClient(t, "ios-ready")
	lastAutoPurgeRepo = time.Now()
	Conf.Sync.Load().Perception = true
	getPetals()

	// 使用本地仓库和独立感知连接，验证完整启动同步流程而不访问云服务。
	type syncMessage struct {
		Cmd    string `json:"cmd"`
		Synced int64  `json:"synced"`
	}
	messages := make(chan syncMessage, 16)
	readerDone := make(chan struct{})
	upgrader := websocket.Upgrader{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer close(readerDone)
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer conn.Close()
		for {
			var msg syncMessage
			if err = conn.ReadJSON(&msg); err != nil {
				return
			}
			messages <- msg
		}
	}))
	defer server.Close()
	conn, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(server.URL, "http"), nil)
	if err != nil {
		t.Fatal(err)
	}
	webSocketConn = conn
	defer func() {
		conn.Close()
		<-readerDone
		webSocketConn = nil
	}()

	assertNotifications := func(want int) {
		t.Helper()
		// 同一连接中的结束标记排在同步通知之后，避免靠等待时间判断没有通知。
		if err := conn.WriteJSON(syncMessage{Cmd: "testMarker"}); err != nil {
			t.Fatal(err)
		}
		count := 0
		timeout := time.NewTimer(5 * time.Second)
		defer timeout.Stop()
		for {
			select {
			case msg := <-messages:
				if msg.Cmd == "testMarker" {
					if count != want {
						t.Fatalf("got %d sync notifications, want %d", count, want)
					}
					return
				}
				if msg.Cmd != "synced" || msg.Synced != Conf.Sync.Load().Synced {
					t.Fatalf("unexpected sync notification: %+v", msg)
				}
				count++
			case <-timeout.C:
				t.Fatal("sync notification marker was not received")
			}
		}
	}
	writeLocal := func(name string) {
		t.Helper()
		if err := os.WriteFile(filepath.Join(util.DataDir, name), []byte(name), 0644); err != nil {
			t.Fatal(err)
		}
	}
	assertResult := func(want int32) {
		t.Helper()
		if result := BootSyncSucc.Load(); result != want {
			t.Fatalf("boot sync result = %d, want %d: %s", result, want, Conf.Sync.Load().Stat)
		}
	}
	assertPublished := func(name string) {
		t.Helper()
		if _, _, err := full.Sync(nil); err != nil {
			t.Fatal(err)
		}
		data, err := os.ReadFile(filepath.Join(full.DataPath, name))
		if err != nil || string(data) != name {
			t.Fatalf("local edit was not published: %q %v", data, err)
		}
	}

	writeLocal("ios-local-edit.txt")
	Conf.Sync.Load().Enabled = false
	BootSyncData()
	assertResult(-1)
	assertNotifications(0)
	Conf.Sync.Load().Enabled = true
	Conf.Sync.Load().Mode = 3
	BootSyncData()
	assertResult(-1)
	assertNotifications(0)
	Conf.Sync.Load().Mode = 1

	key := Conf.Repo.Load().Key
	Conf.Repo.Load().Key = nil
	BootSyncData()
	assertResult(1)
	assertNotifications(0)
	Conf.Repo.Load().Key = key
	BootSyncData()
	assertResult(0)
	assertNotifications(1)
	assertPublished("ios-local-edit.txt")

	BootSyncData()
	assertResult(0)
	assertNotifications(0)

	Conf.Sync.Load().Mode = 2
	writeLocal("manual-mode-edit.txt")
	BootSyncData()
	assertResult(0)
	assertNotifications(0)
	assertPublished("manual-mode-edit.txt")

	Conf.Sync.Load().Mode = 1
	writeLocal("normal-sync-edit.txt")
	BootSyncSucc.Store(1)
	SyncData(false)
	assertResult(0)
	assertNotifications(1)
}
