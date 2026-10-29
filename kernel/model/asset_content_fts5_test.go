// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5

package model

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/88250/lute/ast"
	"github.com/gorilla/websocket"
	"github.com/olahol/melody"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/task"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func assetContentTestChild(t *testing.T) bool {
	t.Helper()
	const childEnv = "SIYUAN_TEST_ASSET_CONTENT"
	if os.Getenv(childEnv) == t.Name() {
		return true
	}
	cmd := exec.Command(os.Args[0], "-test.run=^"+t.Name()+"$", "-test.v", "-test.timeout=60s")
	cmd.Env = append(os.Environ(), childEnv+"="+t.Name())
	if output, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("%v\n%s", err, output)
	}
	return false
}

func setupAssetContentRegression(t *testing.T) string {
	t.Helper()
	setupFileOperationTest(t)
	Conf.Search.Store(conf.NewSearch())
	util.TempDir = t.TempDir()
	util.QueueDir = filepath.Join(util.TempDir, "queue")
	util.DBPath = filepath.Join(util.TempDir, "siyuan.db")
	util.HistoryDBPath = filepath.Join(util.TempDir, "history.db")
	util.AssetContentDBPath = filepath.Join(util.TempDir, "asset_content.db")
	sql.InitDatabase(true)
	sql.InitHistoryDatabase(true)
	if err := sql.InitAssetContentDatabase(true); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(sql.CloseDatabase)
	dir := util.GetDataAssetsAbsPath()
	if err := os.MkdirAll(dir, 0755); err != nil {
		t.Fatal(err)
	}
	return dir
}

func TestAssetContentRelevanceAndPreview(t *testing.T) {
	if !assetContentTestChild(t) {
		return
	}
	setupAssetContentRegression(t)
	strongID, weakID := ast.NewNodeID(), ast.NewNodeID()
	content := "needle needle needle PTFE <oxide>&\nprice $5 and value 123"
	sql.IndexAssetContentsQueue([]*sql.AssetContent{
		{ID: strongID, Name: "strong.txt", Ext: ".txt", Path: "assets/strong.txt", Content: content},
		{ID: weakID, Name: "weak.txt", Ext: ".txt", Path: "assets/weak.txt", Content: "needle " + strings.Repeat("filler ", 60)},
	})
	if err := sql.FlushAssetContentQueue(); err != nil {
		t.Fatal(err)
	}
	for _, method := range []int{0, 1} {
		for _, order := range []int{0, 1, 99} {
			results, count, pages, err := FullTextSearchAssetContent("needle", nil, method, order, 1, 32)
			want := strongID
			if order == 1 {
				want = weakID
			}
			if err != nil || count != 2 || pages != 1 || len(results) != 2 || results[0].ID != want {
				t.Fatalf("method=%d order=%d: results=%+v count=%d pages=%d err=%v", method, order, results, count, pages, err)
			}
		}
	}
	for _, test := range []struct {
		name, query, mark string
		method            int
	}{
		{"keyword", "needle", "<mark>needle</mark>", 0},
		{"syntax", `"needle"`, "<mark>needle</mark>", 1},
		{"regexp", "PTFE.*oxide", "<mark>PTFE &lt;oxide</mark>&gt;", 3},
		{"regexp surrounding whitespace", " PTFE.*oxide ", "<mark>PTFE &lt;oxide</mark>&gt;", 3},
		{"regexp insensitive", "(?i)ptfe", "<mark>PTFE</mark>", 3},
		{"regexp escaped", `\\d+`, "<mark>123</mark>", 3},
		{"regexp dollar", `\$5`, "<mark>$5</mark>", 3},
		{"regexp name only", `strong[.]txt`, "", 3},
		{"regexp invalid", "[", "", 3},
		{"regexp empty match", "^", "", 3},
		{"sql", "SELECT * FROM asset_contents_fts_case_insensitive", "", 2},
		{"empty query", "", "", 0},
	} {
		t.Run(test.name, func(t *testing.T) {
			preview := GetAssetContent(strongID, test.query, test.method)
			if preview == nil || !strings.Contains(preview.Content, "<br>") || strings.Contains(preview.Content, "<oxide>") {
				t.Fatalf("missing or unsafe preview: %+v", preview)
			}
			if test.mark == "" && strings.Contains(preview.Content, "<mark>") || test.mark != "" && !strings.Contains(preview.Content, test.mark) {
				t.Fatalf("unexpected highlight: %s", preview.Content)
			}
		})
	}
	for _, method := range []int{2, 3} {
		query := "PTFE.*oxide"
		if method == 2 {
			query = "SELECT * FROM asset_contents_fts_case_insensitive WHERE name = 'strong.txt'"
		}
		results, count, _, err := FullTextSearchAssetContent(query, nil, method, 0, 1, 32)
		if err != nil || count != 1 || len(results) != 1 || GetAssetContent(results[0].ID, query, method) == nil {
			t.Fatalf("search and preview disagree: method=%d results=%v count=%d err=%v", method, results, count, err)
		}
	}
	if GetAssetContent("missing", "", 2) != nil {
		t.Fatal("invalid ID returned a preview")
	}
}

func TestAssetContentInvalidationAfterParseFailure(t *testing.T) {
	if !assetContentTestChild(t) {
		return
	}
	dir := setupAssetContentRegression(t)
	for _, test := range []struct {
		name        string
		data        []byte
		panicParser bool
	}{
		{"invalid UTF-8", []byte{0xff, 0xfe, 0x61}, false},
		{"oversize text", []byte(strings.Repeat("x", TxtAssetContentMaxSize+1)), false},
		{"parser panic", []byte("broken"), true},
	} {
		t.Run(test.name, func(t *testing.T) {
			p := filepath.Join(dir, "changed.txt")
			for _, data := range [][]byte{[]byte("oldneedle"), test.data, []byte("newneedle")} {
				if err := os.WriteFile(p, data, 0644); err != nil {
					t.Fatal(err)
				}
				parser := assetContentSearcher.parsers[".txt"]
				if test.panicParser && string(data) == "broken" {
					assetContentSearcher.parsers[".txt"] = assetContentTestParser(func(string) *AssetParseResult { panic("parse failure") })
				}
				HandleAssetsChangeEvent(p)
				assetContentSearcher.parsers[".txt"] = parser
				if err := sql.FlushAssetContentQueue(); err != nil {
					t.Fatal(err)
				}
				current := GetAssetContentByPath("assets/changed.txt")
				if string(data) == "oldneedle" || string(data) == "newneedle" {
					if current == nil || current.Content != string(data) {
						t.Fatalf("valid content was not indexed: %+v", current)
					}
				} else if current != nil {
					t.Fatalf("stale content remains: %+v", current)
				}
				actual, err := os.ReadFile(p)
				if err != nil || string(actual) != string(data) {
					t.Fatal("indexing changed the source asset", err)
				}
			}
		})
	}
}

type assetContentTestParser func(string) *AssetParseResult

func (parser assetContentTestParser) Parse(path string) *AssetParseResult { return parser(path) }

func TestAssetContentRebuildCompletion(t *testing.T) {
	if !assetContentTestChild(t) {
		return
	}
	setupAssetContentRegression(t)
	util.Langs = map[string]map[int]string{Conf.Lang: {216: "running", 442: "completed", 443: "failed"}}
	push := melody.New()
	connected := make(chan *melody.Session, 2)
	push.HandleConnect(func(session *melody.Session) {
		if session.Request.URL.Query().Get("publish") == "true" {
			session.Set("isPublish", true)
		}
		util.AddPushChan(session)
		connected <- session
	})
	push.HandleDisconnect(util.RemovePushChan)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _ = push.HandleRequest(w, r) }))
	var connections []*websocket.Conn
	var sessions []*melody.Session
	for i := 0; i < 2; i++ {
		url := fmt.Sprintf("ws%s/ws?app=asset-content-test&id=%d&type=main&publish=%t", strings.TrimPrefix(server.URL, "http"), i, i == 1)
		connection, response, err := websocket.DefaultDialer.Dial(url, nil)
		if err != nil {
			t.Fatal(err)
		}
		_ = response.Body.Close()
		connections = append(connections, connection)
		sessions = append(sessions, <-connected)
	}
	t.Cleanup(func() {
		for i, connection := range connections {
			_ = connection.Close()
			util.RemovePushChan(sessions[i])
		}
		_ = push.Close()
		server.Close()
	})
	readEvents := func() [][]struct{ Cmd, Msg string } {
		t.Helper()
		if err := push.Broadcast([]byte(`{"cmd":"asset-index-barrier"}`)); err != nil {
			t.Fatal(err)
		}
		ret := make([][]struct{ Cmd, Msg string }, len(connections))
		for i, connection := range connections {
			_ = connection.SetReadDeadline(time.Now().Add(5 * time.Second))
			for {
				var event struct{ Cmd, Msg string }
				if err := connection.ReadJSON(&event); err != nil {
					t.Fatal(err)
				}
				if event.Cmd == "asset-index-barrier" {
					break
				}
				ret[i] = append(ret[i], event)
			}
		}
		return ret
	}
	for _, mode := range []string{"success", "empty", "walk failure", "parser panic", "write failure"} {
		t.Run(mode, func(t *testing.T) {
			util.DataDir = t.TempDir()
			dir := util.GetDataAssetsAbsPath()
			if mode == "walk failure" {
				if err := os.WriteFile(dir, []byte("not a directory"), 0644); err != nil {
					t.Fatal(err)
				}
			} else if err := os.MkdirAll(dir, 0755); err != nil {
				t.Fatal(err)
			}
			entered, release := make(chan struct{}), make(chan struct{})
			var unblock sync.Once
			t.Cleanup(func() { unblock.Do(func() { close(release) }) })
			assetContentSearcher = NewAssetsSearcher()
			calls := 0
			assetContentSearcher.parsers[".txt"] = assetContentTestParser(func(string) *AssetParseResult {
				calls++
				close(entered)
				<-release
				if mode == "parser panic" {
					panic("parser failed")
				}
				if mode == "write failure" {
					sql.CloseDatabase()
				}
				return &AssetParseResult{Content: "last batch committed"}
			})
			if mode != "empty" && mode != "walk failure" {
				if err := os.WriteFile(filepath.Join(dir, "last.txt"), []byte("source"), 0644); err != nil {
					t.Fatal(err)
				}
			}
			ReindexAssetContent()
			if calls != 0 {
				t.Fatal("submission ran indexing synchronously")
			}
			// 任务队列只取出已超过延迟的任务，避开 Windows 时钟分辨率下的同一时间点。
			time.Sleep(10 * time.Millisecond)
			done := make(chan struct{})
			go func() { task.ExecTaskJob(); close(done) }()
			if mode != "empty" && mode != "walk failure" {
				select {
				case <-entered:
				case <-time.After(5 * time.Second):
					t.Fatal("indexer did not start")
				}
				ReindexAssetContent()
				for _, events := range readEvents() {
					for _, event := range events {
						if event.Cmd == "assetContentIndexCompleted" || event.Msg == "completed" {
							t.Fatal("completion was sent before the final batch was written")
						}
					}
				}
				unblock.Do(func() { close(release) })
			}
			select {
			case <-done:
			case <-time.After(5 * time.Second):
				t.Fatal("indexer did not finish")
			}
			events := readEvents()
			if len(events[1]) != 0 {
				t.Fatalf("publish session received index notifications: %+v", events[1])
			}
			completed, failed := false, false
			for _, event := range events[0] {
				completed = completed || event.Cmd == "assetContentIndexCompleted"
				failed = failed || event.Msg == "failed"
			}
			wantSuccess := mode == "success" || mode == "empty"
			if completed != wantSuccess || failed == wantSuccess {
				t.Fatalf("wrong completion result: %+v", events[0])
			}
			if mode == "success" {
				indexed := GetAssetContentByPath("assets/last.txt")
				if indexed == nil || indexed.Content != "last batch committed" || calls != 1 {
					t.Fatalf("completion preceded indexing or duplicate tasks ran: %+v, calls=%d", indexed, calls)
				}
			}
		})
	}
}
