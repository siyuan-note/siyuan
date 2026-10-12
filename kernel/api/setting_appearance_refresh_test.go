package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/olahol/melody"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAPIContractAppearanceSameSelectionRefreshesPackages(t *testing.T) {
	for _, endpoint := range []string{"setAppearance", "patch"} {
		t.Run(endpoint, func(t *testing.T) {
			previous, readOnly, mode, lang := model.Conf, util.ReadOnly, util.Mode, util.Lang
			working, appearance, themes, icons := util.WorkingDir, util.AppearancePath, util.ThemesPath, util.IconsPath
			confDir, dataDir, repoDir := util.ConfDir, util.DataDir, util.RepoDir
			t.Cleanup(func() {
				model.Conf, util.ReadOnly, util.Mode, util.Lang = previous, readOnly, mode, lang
				util.WorkingDir, util.AppearancePath, util.ThemesPath, util.IconsPath = working, appearance, themes, icons
				util.ConfDir, util.DataDir, util.RepoDir = confDir, dataDir, repoDir
				model.ApplyConfRuntime()
			})
			root := t.TempDir()
			t.Cleanup(model.CloseWatchThemes)
			util.WorkingDir, util.ConfDir = filepath.Join(root, "working"), filepath.Join(root, "conf")
			util.DataDir, util.RepoDir = filepath.Join(root, "data"), filepath.Join(root, "repo")
			util.AppearancePath = filepath.Join(util.ConfDir, "appearance")
			util.ThemesPath, util.IconsPath = filepath.Join(util.DataDir, "themes"), filepath.Join(util.DataDir, "icons")
			if err := os.MkdirAll(util.ConfDir, 0755); err != nil {
				t.Fatal(err)
			}
			util.Mode, util.ReadOnly = "prod", false
			model.Conf = model.NewAppConf()
			model.NormalizeAppConf(model.Conf)
			write := func(path, content string) {
				t.Helper()
				if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(path, []byte(content), 0644); err != nil {
					t.Fatal(err)
				}
			}
			for _, name := range []string{"daylight", "midnight", "custom"} {
				base := filepath.Join(util.WorkingDir, "appearance", "themes", name)
				if name == "custom" {
					base = filepath.Join(util.ThemesPath, name)
				}
				write(filepath.Join(base, "theme.json"), `{"name":"`+name+`","version":"1.0.0","modes":["light","dark"]}`)
				write(filepath.Join(base, "theme.css"), ":root {}")
			}
			for _, name := range []string{"litheness", "custom"} {
				base := filepath.Join(util.WorkingDir, "appearance", "icons", name)
				if name == "custom" {
					base = filepath.Join(util.IconsPath, name)
				}
				write(filepath.Join(base, "icon.json"), `{"name":"`+name+`","version":"1.0.0"}`)
				write(filepath.Join(base, "icon.js"), "// icon")
			}
			write(filepath.Join(util.WorkingDir, "appearance", "emojis", "conf.json"), "[]")
			selected := conf.NewAppearance()
			selected.ThemeLight, selected.ThemeDark, selected.Icon = "custom", "custom", "custom"
			selected.ModeOS, selected.HideStatusBar = false, true
			selected.CloseButtonBehavior = 5
			body, err := json.Marshal(selected)
			if err != nil {
				t.Fatal(err)
			}
			code, message, _ := settingContractRequest(t, "setAppearance", setAppearance, string(body))
			if code != 0 || model.Conf.Appearance.Load().ThemeLight != "custom" || model.Conf.Appearance.Load().Icon != "custom" ||
				model.Conf.Appearance.Load().CloseButtonBehavior != 0 {
				t.Fatalf("initial package selection failed: %d %s", code, message)
			}
			model.CloseWatchThemes()
			for _, directory := range []string{util.ThemesPath, util.IconsPath} {
				if err = os.RemoveAll(filepath.Join(directory, "custom")); err != nil {
					t.Fatal(err)
				}
			}
			connection, push := appearanceSettingTestConnection(t)
			var data json.RawMessage
			if endpoint == "setAppearance" {
				code, message, data = settingContractRequest(t, endpoint, setAppearance, string(body))
			} else {
				code, message, data = settingContractRequest(t, endpoint, patchSetting,
					`{"appearance":{"themeLight":"custom","themeDark":"custom","icon":"custom","closeButtonBehavior":5}}`)
			}
			if code != 0 {
				t.Fatalf("refresh failed: %d %s", code, message)
			}
			assertFallback := func(value *conf.Appearance) {
				t.Helper()
				if value.ThemeLight != "daylight" || value.ThemeDark != "midnight" || value.Icon != "litheness" ||
					value.ThemeVer != "1.0.0" || value.IconVer != "1.0.0" || !value.HideStatusBar || value.CloseButtonBehavior != 0 {
					t.Fatalf("refresh did not expose the final fallback snapshot: %+v", value)
				}
			}
			assertFallback(model.Conf.Appearance.Load())
			if endpoint == "setAppearance" {
				var response conf.Appearance
				if err = json.Unmarshal(data, &response); err != nil {
					t.Fatal(err)
				}
				assertFallback(&response)
			} else if string(data) != "null" {
				t.Fatalf("successful patch response changed: %s", data)
			}
			if err = push.Broadcast([]byte(`{"cmd":"appearance-refresh-barrier"}`)); err != nil {
				t.Fatal(err)
			}
			if err = connection.SetReadDeadline(time.Now().Add(5 * time.Second)); err != nil {
				t.Fatal(err)
			}
			notifications := 0
			for {
				var event struct {
					Cmd  string
					Data json.RawMessage
				}
				if err = connection.ReadJSON(&event); err != nil {
					t.Fatal(err)
				}
				if event.Cmd == "appearance-refresh-barrier" {
					break
				}
				if event.Cmd == "setAppearance" {
					var appearance conf.Appearance
					if err = json.Unmarshal(event.Data, &appearance); err != nil {
						t.Fatal(err)
					}
					assertFallback(&appearance)
					notifications++
				}
			}
			if notifications != 1 {
				t.Fatalf("expected one refreshed appearance notification, got %d", notifications)
			}
		})
	}
}

func appearanceSettingTestConnection(t *testing.T) (*websocket.Conn, *melody.Melody) {
	t.Helper()
	push := melody.New()
	connected := make(chan *melody.Session, 1)
	push.HandleConnect(func(session *melody.Session) {
		util.AddPushChan(session)
		connected <- session
	})
	push.HandleDisconnect(util.RemovePushChan)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _ = push.HandleRequest(w, r) }))
	t.Cleanup(func() { _ = push.Close(); server.Close() })
	connection, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(server.URL, "http")+
		"/?app=appearance-refresh-test&id=main&type=main", nil)
	if err != nil {
		t.Fatal(err)
	}
	select {
	case session := <-connected:
		t.Cleanup(func() { _ = connection.Close(); util.RemovePushChan(session) })
	case <-time.After(5 * time.Second):
		_ = connection.Close()
		t.Fatal("websocket registration timed out")
	}
	return connection, push
}
