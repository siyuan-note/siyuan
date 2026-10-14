package model

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/olahol/melody"
	"github.com/siyuan-note/siyuan/kernel/util"
)

type assetUploadNotificationEvent struct {
	Cmd  string
	Code int
	Msg  string
	Data struct {
		ID           string
		CloseTimeout int
	}
}

func TestUploadAssetsNotificationScope(t *testing.T) {
	originalConf, originalLangs := Conf, util.Langs
	originalWorkspace, originalData, originalConfDir, originalRepo := util.WorkspaceDir, util.DataDir, util.ConfDir, util.RepoDir
	originalToken, originalTokenTime := uploadToken, uploadTokenTime
	t.Cleanup(func() {
		Conf, util.Langs = originalConf, originalLangs
		util.WorkspaceDir, util.DataDir, util.ConfDir, util.RepoDir = originalWorkspace, originalData, originalConfDir, originalRepo
		uploadToken, uploadTokenTime = originalToken, originalTokenTime
	})
	Conf = NewAppConf()
	Conf.Lang = "en"
	util.Langs = map[string]map[int]string{"en": {
		27: "Uploading %v", 31: "Sign in required", 247: "Asset %s exceeds %s",
	}}
	util.WorkspaceDir = t.TempDir()
	util.DataDir = filepath.Join(util.WorkspaceDir, "data")
	util.ConfDir = filepath.Join(util.WorkspaceDir, "conf")
	util.RepoDir = filepath.Join(util.WorkspaceDir, "repo")
	assetPath := filepath.Join(util.DataDir, "assets", "oversized.dat")
	if err := os.MkdirAll(filepath.Dir(assetPath), 0755); err != nil {
		t.Fatal(err)
	}
	file, err := os.Create(assetPath)
	if err != nil {
		t.Fatal(err)
	}
	err = file.Truncate(3*1024*1024 + 1)
	closeErr := file.Close()
	if err != nil || closeErr != nil {
		t.Fatalf("prepare oversized asset: %v, %v", err, closeErr)
	}

	push := melody.New()
	connected := make(chan *melody.Session, 1)
	push.HandleConnect(func(session *melody.Session) {
		if session.Request.URL.Query().Get("publish") == "true" {
			session.Set("isPublish", true)
		}
		if session.Request.URL.Query().Get("auth") == "true" {
			session.Set("authSession", true)
		}
		util.AddPushChan(session)
		connected <- session
	})
	push.HandleDisconnect(util.RemovePushChan)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = push.HandleRequest(w, r)
	}))
	var connections []*websocket.Conn
	var sessions []*melody.Session
	t.Cleanup(func() {
		for _, connection := range connections {
			_ = connection.Close()
		}
		for _, session := range sessions {
			util.RemovePushChan(session)
		}
		_ = push.Close()
		server.Close()
	})
	first, second := util.WorkspaceDir+"-first", util.WorkspaceDir+"-second"
	for _, query := range []string{
		"app=" + url.QueryEscape(first) + "&id=main&type=main",
		"app=" + url.QueryEscape(second) + "&id=main&type=main",
		"app=" + url.QueryEscape(first) + "&id=publish&type=main&publish=true",
		"app=" + url.QueryEscape(first) + "&id=auth&type=main&auth=true",
		"app=" + url.QueryEscape(first) + "&id=tree&type=filetree",
	} {
		connection, response, dialErr := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(server.URL, "http")+"/ws?"+query, nil)
		if dialErr != nil {
			t.Fatal(dialErr)
		}
		_ = response.Body.Close()
		connections = append(connections, connection)
		select {
		case session := <-connected:
			sessions = append(sessions, session)
		case <-time.After(5 * time.Second):
			t.Fatal("notification connection was not registered")
		}
	}

	for _, failure := range []string{"token", "size"} {
		for _, ignore := range []bool{false, true} {
			for _, target := range []string{"first", "second", "absent", "legacy"} {
				t.Run(fmt.Sprintf("%s/ignore=%v/%s", failure, ignore, target), func(t *testing.T) {
					// 未登录直接拒绝令牌请求；缓存令牌配合超限本地文件在上传请求前退出。
					uploadToken, uploadTokenTime = "unused-test-token", 0
					if failure == "size" {
						uploadTokenTime = time.Now().Unix()
					}
					app := map[string]string{"first": first, "second": second, "absent": first + "-closed"}[target]
					count, uploadErr := uploadAssets2CloudWithApp([]string{"assets/oversized.dat"}, bizTypeUploadAssets, ignore, app)
					if count != 0 || uploadErr != nil {
						t.Fatalf("unexpected upload result: count=%d err=%v", count, uploadErr)
					}
					// 屏障与通知按连接排队，断言没有通知时无需等待读超时。
					if broadcastErr := push.Broadcast([]byte(`{"cmd":"asset-notification-barrier"}`)); broadcastErr != nil {
						t.Fatal(broadcastErr)
					}
					for i, connection := range connections {
						if deadlineErr := connection.SetReadDeadline(time.Now().Add(5 * time.Second)); deadlineErr != nil {
							t.Fatal(deadlineErr)
						}
						var events []assetUploadNotificationEvent
						for {
							var event assetUploadNotificationEvent
							if readErr := connection.ReadJSON(&event); readErr != nil {
								t.Fatal(readErr)
							}
							if event.Cmd == "asset-notification-barrier" {
								break
							}
							events = append(events, event)
						}
						receives := i == 0 && (target == "first" || target == "legacy") || i == 1 && (target == "second" || target == "legacy")
						if !receives {
							if len(events) != 0 {
								t.Fatalf("client %d received unrelated events: %+v", i, events)
							}
							continue
						}
						wantCount, errorIndex := 3, 1
						if ignore {
							wantCount, errorIndex = 1, 0
						}
						if len(events) != wantCount {
							t.Fatalf("client %d received %+v, want %d events", i, events, wantCount)
						}
						if !ignore {
							initial, clear := events[0], events[2]
							if initial.Cmd != "msg" || initial.Code != 0 || initial.Msg != "Uploading 1" || initial.Data.ID == "" || initial.Data.CloseTimeout != 3000 {
								t.Fatalf("unexpected initial notification: %+v", initial)
							}
							if clear.Cmd != "cmsg" || clear.Code != 0 || clear.Msg != "" || clear.Data.ID != initial.Data.ID {
								t.Fatalf("cleanup did not clear the operation's notification: %+v", clear)
							}
						}
						failureEvent := events[errorIndex]
						wantCode, wantTimeout, wantMessage := 0, 5000, "Sign in required"
						if failure == "size" {
							wantCode, wantTimeout, wantMessage = -1, 30000, "Asset oversized.dat exceeds 3.0 MiB"
						}
						if failureEvent.Cmd != "msg" || failureEvent.Code != wantCode || failureEvent.Data.ID == "" || failureEvent.Data.CloseTimeout != wantTimeout || failureEvent.Msg != wantMessage {
							t.Fatalf("unexpected failure notification: %+v", failureEvent)
						}
					}
				})
			}
		}
	}
}
