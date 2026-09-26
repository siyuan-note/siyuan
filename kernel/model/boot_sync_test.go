package model

import (
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/siyuan-note/siyuan/kernel/util"
)

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
	lastAutoPurgeRepo = time.Now()
	Conf.Sync.Perception = true
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
				if msg.Cmd != "synced" || msg.Synced != Conf.Sync.Synced {
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
			t.Fatalf("boot sync result = %d, want %d: %s", result, want, Conf.Sync.Stat)
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
	Conf.Sync.Enabled = false
	BootSyncData()
	assertResult(-1)
	assertNotifications(0)
	Conf.Sync.Enabled = true
	Conf.Sync.Mode = 3
	BootSyncData()
	assertResult(-1)
	assertNotifications(0)
	Conf.Sync.Mode = 1

	key := Conf.Repo.Key
	Conf.Repo.Key = nil
	BootSyncData()
	assertResult(1)
	assertNotifications(0)
	Conf.Repo.Key = key
	BootSyncData()
	assertResult(0)
	assertNotifications(1)
	assertPublished("ios-local-edit.txt")

	BootSyncData()
	assertResult(0)
	assertNotifications(0)

	Conf.Sync.Mode = 2
	writeLocal("manual-mode-edit.txt")
	BootSyncData()
	assertResult(0)
	assertNotifications(0)
	assertPublished("manual-mode-edit.txt")

	Conf.Sync.Mode = 1
	writeLocal("normal-sync-edit.txt")
	BootSyncSucc.Store(1)
	SyncData(false)
	assertResult(0)
	assertNotifications(1)
}
