// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5

package model

import (
	"bytes"
	gosql "database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/88250/lute/parse"
	"github.com/gorilla/websocket"
	"github.com/olahol/melody"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestDocumentMoveIndexFailurePublishesCompletedSubtree(t *testing.T) {
	for _, failed := range []string{"root", "child"} {
		t.Run(failed, func(t *testing.T) {
			f := setupFileOperationTest(t)
			setupFoldTransactionDatabase(t, f)
			root, _, err := filesys.ReadTreeSnapshot(f.box.ID, f.sourcePath)
			if err != nil {
				t.Fatal(err)
			}
			child := addDocumentCollectionChild(t, root)
			grandchild := addDocumentCollectionChild(t, child)
			trees := []*treenode.BlockTree{}
			before := map[string][]byte{}
			for _, tree := range []*parse.Tree{root, child, grandchild} {
				treenode.UpsertBlockTree(tree)
				sql.UpsertTreeQueue(tree)
				trees = append(trees, &treenode.BlockTree{ID: tree.ID, BoxID: tree.Box, Path: tree.Path, HPath: tree.HPath})
				before[tree.ID], err = os.ReadFile(filepath.Join(util.DataDir, tree.Box, tree.Path))
				if err != nil {
					t.Fatal(err)
				}
			}
			sql.FlushQueue()
			ws := documentMoveTestSocket(t)
			database, err := gosql.Open("sqlite3", util.BlockTreeDBPath)
			if err != nil {
				t.Fatal(err)
			}
			defer database.Close()
			failedID := root.ID
			if failed == "child" {
				failedID = child.ID
			}
			if _, err = database.Exec("CREATE TRIGGER fail_move BEFORE INSERT ON blocktrees WHEN NEW.id = '" + failedID + "' AND NEW.path != '" + trees[map[string]int{"root": 0, "child": 1}[failed]].Path + "' BEGIN SELECT RAISE(ABORT, 'injected move index failure'); END"); err != nil {
				t.Fatal(err)
			}
			revision := pendingSync.begin()
			if err = MoveDocs([]string{root.Path}, f.box.ID, f.targetPath, "move-failure-test"); err == nil {
				t.Fatal("index failure was not returned")
			}
			if pendingSync.begin() <= revision {
				t.Error("completed physical move did not mark synchronization pending")
			}
			order, err := readSortConfMap(filepath.Join(util.DataDir, f.box.ID, ".siyuan", "sort.json"))
			if err != nil {
				t.Fatal(err)
			}
			if _, ok := order[root.ID]; !ok {
				t.Error("completed physical move was omitted from sibling order")
			}
			sql.FlushQueue()
			for _, tree := range trees {
				newPath := path.Join(strings.TrimSuffix(f.targetPath, ".sy"), tree.Path)
				current, err := os.ReadFile(filepath.Join(util.DataDir, tree.BoxID, newPath))
				if err != nil || !bytes.Equal(current, before[tree.ID]) {
					t.Fatal("move changed source bytes", tree.ID, err)
				}
				block := sql.GetBlockInBox(tree.ID, tree.BoxID)
				if block == nil || block.Path != newPath || block.HPath != "/Target"+tree.HPath {
					t.Errorf("SQL path did not follow completed move: %+v", block)
				}
			}
			seen := map[string]bool{}
			batch := false
			ws.SetReadDeadline(time.Now().Add(5 * time.Second))
			for !batch || len(seen) < len(trees) {
				_, data, err := ws.ReadMessage()
				if err != nil {
					t.Fatal("missing move notifications", seen, batch, err)
				}
				var event struct {
					Cmd  string          `json:"cmd"`
					Data json.RawMessage `json:"data"`
				}
				if err = json.Unmarshal(data, &event); err != nil {
					t.Fatal(err)
				}
				if event.Cmd == "moveDoc" {
					var result moveDocResult
					if err = json.Unmarshal(event.Data, &result); err != nil {
						t.Fatal(err)
					}
					for _, previous := range trees {
						if previous.ID == util.GetTreeID(result.NewPath) && (result.FromPath != previous.Path || result.FromNotebook != f.box.ID || result.ToNotebook != f.box.ID) {
							t.Fatalf("move notification did not preserve the actual source identity: %+v", result)
						}
					}
					seen[util.GetTreeID(result.NewPath)] = true
				}
				if event.Cmd == "moveDocs" {
					var result struct {
						Moves []moveDocResult `json:"moves"`
					}
					if err = json.Unmarshal(event.Data, &result); err != nil {
						t.Fatal(err)
					}
					batch = len(result.Moves) == 1 && result.Moves[0].NewPath == "/"+f.targetID+"/"+root.ID+".sy"
				}
			}
			journals, err := readDocumentSourceJournals()
			if err != nil || len(journals) != 1 || !journals[0].Forward {
				t.Fatal("failed indexing lost its recovery record", err)
			}
			if _, err = database.Exec("DROP TRIGGER fail_move"); err != nil {
				t.Fatal(err)
			}
			if err = recoverDocumentSources(); err != nil {
				t.Fatal(err)
			}
			indexBox(f.box.ID)
			sql.FlushQueue()
			for _, previous := range trees {
				newPath := path.Join(strings.TrimSuffix(f.targetPath, ".sy"), previous.Path)
				tree, _, err := filesys.ReadTreeSnapshot(previous.BoxID, newPath)
				if err != nil {
					t.Fatal(err)
				}
				assertIndexRepairDocument(t, tree)
			}
			if hasDocumentSourceRecovery(f.box.ID) {
				t.Error("successful authenticated reindex retained move recovery")
			}
		})
	}
}

func documentMoveTestSocket(t *testing.T) *websocket.Conn {
	t.Helper()
	m := melody.New()
	connected := make(chan struct{}, 1)
	m.HandleConnect(func(s *melody.Session) { util.AddPushChan(s); connected <- struct{}{} })
	m.HandleDisconnect(util.RemovePushChan)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _ = m.HandleRequest(w, r) }))
	connection, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(server.URL, "http")+"/?app=move-failure-test&id=main&type=main", nil)
	if err != nil {
		server.Close()
		t.Fatal(err)
	}
	t.Cleanup(func() { connection.Close(); m.Close(); server.Close() })
	select {
	case <-connected:
	case <-time.After(5 * time.Second):
		t.Fatal("test socket did not connect")
	}
	return connection
}
