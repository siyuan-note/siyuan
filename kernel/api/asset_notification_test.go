package api

import (
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"github.com/olahol/melody"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAPIContractUnusedAssetNotificationScope(t *testing.T) {
	testAPIContractUnusedNotificationScope(t, false)
}

func TestAPIContractUnusedAttributeViewNotificationScope(t *testing.T) {
	testAPIContractUnusedNotificationScope(t, true)
}

func testAPIContractUnusedNotificationScope(t *testing.T, attributeViews bool) {
	t.Helper()
	endpoint, handler := "/api/asset/getUnusedAssets", getUnusedAssets
	if attributeViews {
		endpoint, handler = "/api/av/getUnusedAttributeViews", getUnusedAttributeViews
	}
	for _, test := range []struct {
		name  string
		count int
		app   string
		want  []int
	}{
		{name: "below limit", count: 511, app: "first", want: []int{0, 0, 0, 0}},
		{name: "at limit", count: 512, app: "first", want: []int{0, 0, 0, 0}},
		{name: "first frontend", count: 513, app: "first", want: []int{1, 0, 0, 0}},
		{name: "second frontend", count: 513, app: "second", want: []int{0, 1, 0, 0}},
		{name: "legacy caller", count: 513, want: []int{1, 1, 0, 0}},
		{name: "absent frontend", count: 513, app: "closed", want: []int{0, 0, 0, 0}},
	} {
		t.Run(test.name, func(t *testing.T) {
			assets := setupAssetContractWorkspace(t)
			model.Conf.FileTree = conf.NewFileTree()
			if attributeViews {
				assets = filepath.Join(util.DataDir, "storage", "av")
				if err := os.MkdirAll(assets, 0755); err != nil {
					t.Fatal(err)
				}
			}
			for i := 0; i < test.count; i++ {
				name, content := fmt.Sprintf("unused-%04d.txt", i), []byte("unused")
				if attributeViews {
					name = fmt.Sprintf("20261003000000-%07d.json", i)
					content = []byte(`{"name":"unused","keyValues":[]}`)
				}
				if err := os.WriteFile(filepath.Join(assets, name), content, 0644); err != nil {
					t.Fatal(err)
				}
			}
			push := melody.New()
			connected := make(chan *melody.Session, 1)
			push.HandleConnect(func(session *melody.Session) {
				if session.Request.URL.Query().Get("publish") == "true" {
					session.Set("isPublish", true)
				}
				util.AddPushChan(session)
				connected <- session
			})
			push.HandleDisconnect(util.RemovePushChan)
			engine := gin.New()
			engine.POST(endpoint, handler)
			engine.GET("/ws", func(c *gin.Context) { _ = push.HandleRequest(c.Writer, c.Request) })
			server := httptest.NewServer(engine)
			t.Cleanup(func() { _ = push.Close(); server.Close() })
			var connections []*websocket.Conn
			appPrefix := t.TempDir() + "-"
			for _, query := range []string{
				"app=" + url.QueryEscape(appPrefix+"first") + "&id=main&type=main",
				"app=" + url.QueryEscape(appPrefix+"second") + "&id=main&type=main",
				"app=" + url.QueryEscape(appPrefix+"first") + "&id=published&type=main&publish=true",
				"app=" + url.QueryEscape(appPrefix+"first") + "&id=tree&type=filetree",
			} {
				connection, response, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(server.URL, "http")+"/ws?"+query, nil)
				if err != nil {
					t.Fatal(err)
				}
				_ = response.Body.Close()
				t.Cleanup(func() { _ = connection.Close() })
				select {
				case session := <-connected:
					t.Cleanup(func() { util.RemovePushChan(session) })
				case <-time.After(5 * time.Second):
					t.Fatal("notification connection was not registered")
				}
				connections = append(connections, connection)
			}
			request := httptest.NewRequest("POST", endpoint, strings.NewReader(`{}`))
			if test.app != "" {
				request.Header.Set("X-SiYuan-App-ID", appPrefix+test.app)
			}
			recorder := httptest.NewRecorder()
			engine.ServeHTTP(recorder, request)
			requireAPIContract(t, "POST", endpoint, recorder)
			var response struct {
				Code int
				Data []apicontract.AssetUnusedItem
			}
			if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil || response.Code != 0 || len(response.Data) != min(test.count, 512) {
				t.Fatalf("unexpected query response: %s, %v", recorder.Body.String(), err)
			}
			// 屏障与提示使用同一连接队列，验证未收到提示时无需等待超时。
			if err := push.Broadcast([]byte(`{"cmd":"barrier"}`)); err != nil {
				t.Fatal(err)
			}
			for i, connection := range connections {
				if err := connection.SetReadDeadline(time.Now().Add(5 * time.Second)); err != nil {
					t.Fatal(err)
				}
				count := 0
				for {
					var event struct {
						Cmd  string
						Code int
						Data struct {
							ID           string
							CloseTimeout int
						}
					}
					if err := connection.ReadJSON(&event); err != nil {
						t.Fatal(err)
					}
					if event.Cmd == "barrier" {
						break
					}
					if event.Cmd != "msg" || event.Code != 0 || event.Data.ID == "" || event.Data.CloseTimeout != 5000 {
						t.Fatalf("unexpected notification: %+v", event)
					}
					count++
				}
				if count != test.want[i] {
					t.Fatalf("connection %d received %d notifications, want %d", i, count, test.want[i])
				}
			}
		})
	}
}
