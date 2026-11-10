// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/olahol/melody"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestNotebookIconChangedReachesFileTreeAndDetachedEditor(t *testing.T) {
	hub := melody.New()
	connected := make(chan struct{}, 3)
	hub.HandleConnect(func(session *melody.Session) {
		util.AddPushChan(session)
		connected <- struct{}{}
	})
	hub.HandleDisconnect(util.RemovePushChan)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = hub.HandleRequest(w, r)
	}))
	defer server.Close()
	defer hub.Close()
	var clients []*websocket.Conn
	for _, typ := range []string{"filetree", "protyle", "main"} {
		url := "ws" + strings.TrimPrefix(server.URL, "http") + "?app=notebook-icon-" + typ + "&id=" + typ + "&type=" + typ
		client, _, err := websocket.DefaultDialer.Dial(url, nil)
		if err != nil {
			t.Fatal(err)
		}
		defer client.Close()
		clients = append(clients, client)
		select {
		case <-connected:
		case <-time.After(3 * time.Second):
			t.Fatal("websocket did not connect")
		}
	}
	pushNotebookIconChanged("notebook", "1f4d2")
	for _, client := range clients {
		_ = client.SetReadDeadline(time.Now().Add(3 * time.Second))
		var result struct {
			Cmd  string
			Data map[string]string
		}
		if err := client.ReadJSON(&result); err != nil {
			t.Fatal(err)
		}
		if result.Cmd != "notebookIconChanged" || result.Data["boxID"] != "notebook" || result.Data["icon"] != "1f4d2" {
			t.Fatalf("unexpected icon event: %+v", result)
		}
	}
}

func TestPluginStorageName(t *testing.T) {
	originalDataDir := util.DataDir
	util.DataDir = filepath.Join(t.TempDir(), "data")
	t.Cleanup(func() {
		util.DataDir = originalDataDir
	})

	tests := []struct {
		name       string
		path       string
		pluginName string
		ok         bool
	}{
		{
			name:       "nested plugin data",
			path:       filepath.Join(util.DataDir, "storage", "petal", "sample", "nested", "data.json"),
			pluginName: "sample",
			ok:         true,
		},
		{
			name:       "plugin storage root",
			path:       filepath.Join(util.DataDir, "storage", "petal", "sample"),
			pluginName: "sample",
			ok:         true,
		},
		{
			name: "petal configuration",
			path: filepath.Join(util.DataDir, "storage", "petal", "petals.json"),
		},
		{
			name: "petal storage root",
			path: filepath.Join(util.DataDir, "storage", "petal"),
		},
		{
			name: "other storage",
			path: filepath.Join(util.DataDir, "storage", "local.json"),
		},
		{
			name: "outside data directory",
			path: filepath.Join(filepath.Dir(util.DataDir), "outside.json"),
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			pluginName, ok := pluginStorageName(test.path)
			if test.pluginName != pluginName || test.ok != ok {
				t.Fatalf("expected plugin name [%s] and ok [%v], got [%s] and [%v]",
					test.pluginName, test.ok, pluginName, ok)
			}
		})
	}
}
