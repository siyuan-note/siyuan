// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5

package sql

import (
	"bytes"
	"context"
	stdsql "database/sql"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/eventbus"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestIndexRecoveryLifecycle(t *testing.T) {
	if os.Getenv("SIYUAN_TEST_INDEX_RECOVERY") != "1" {
		ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
		defer cancel()
		cmd := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestIndexRecoveryLifecycle$", "-test.timeout=60s", "-test.v")
		cmd.Env = append(os.Environ(), "SIYUAN_TEST_INDEX_RECOVERY=1")
		if output, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("index recovery subprocess: %v\n%s", err, output)
		}
		return
	}

	root := t.TempDir()
	util.WorkspaceDir = root
	util.DataDir, util.TempDir, util.ConfDir = filepath.Join(root, "data"), filepath.Join(root, "temp"), filepath.Join(root, "conf")
	util.QueueDir = filepath.Join(util.TempDir, "queue")
	util.DBPath, util.BlockTreeDBPath = filepath.Join(util.TempDir, util.DBName), filepath.Join(util.TempDir, "blocktree.db")
	util.HistoryDBPath, util.AssetContentDBPath = filepath.Join(util.TempDir, "history.db"), filepath.Join(util.TempDir, "asset_content.db")
	for _, dir := range []string{util.DataDir, util.TempDir, util.ConfDir} {
		if err := os.MkdirAll(dir, 0755); err != nil {
			t.Fatal(err)
		}
	}
	InitDatabase(true)
	InitHistoryDatabase(true)
	InitAssetContentDatabase(true)
	t.Cleanup(CloseDatabase)
	IndexIgnoreCached, indexIgnore = true, nil
	box := "20260922000000-index01"
	if err := os.MkdirAll(filepath.Join(util.DataDir, box), 0755); err != nil {
		t.Fatal(err)
	}
	newTree := func() *parse.Tree {
		id := ast.NewNodeID()
		tree := treenode.NewTree(box, "/"+id+".sy", "/Recovery", "Recovery")
		paragraph := treenode.NewParagraph("")
		paragraph.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("recovery content")})
		tree.Root.AppendChild(paragraph)
		if _, err := filesys.WriteTree(tree); err != nil {
			t.Fatal(err)
		}
		treenode.IndexBlockTree(tree)
		return tree
	}
	restartQueue := func() {
		operationQueue = nil
		initIndexQueue()
		recoverIndexQueue()
	}
	assertRows := func(tree *parse.Tree) {
		t.Helper()
		var rows, unique int
		if err := db.QueryRow("SELECT COUNT(*), COUNT(DISTINCT id) FROM blocks WHERE root_id = ?", tree.ID).Scan(&rows, &unique); err != nil {
			t.Fatal(err)
		}
		if rows != 3 || unique != rows {
			t.Fatalf("incorrect or duplicated document index: %d rows, %d unique", rows, unique)
		}
	}

	t.Run("interrupted replay and live append", func(t *testing.T) {
		ClearQueue()
		first, second, live := newTree(), newTree(), newTree()
		IndexTreeQueue(first)
		IndexTreeQueue(second)
		restartQueue()
		interrupted := false
		appended := make(chan struct{})
		handler := func(id string) {
			if id == first.ID && !interrupted {
				interrupted = true
				util.IsExiting.Store(true)
				go func() {
					IndexTreeQueue(live)
					close(appended)
				}()
			}
		}
		eventbus.Subscribe(eventbus.EvtEmbeddingDirty, handler)
		FlushQueue()
		<-appended
		util.IsExiting.Store(false)
		if !interrupted || len(operationQueue) != 2 || operationQueue[0].recoveryEntry.ID != second.ID || operationQueue[1].indexTree != live {
			t.Fatal("interruption did not retain pending operations before live appends")
		}
		assertRows(first)
		if len(loadIndexQueue()) != 3 {
			t.Fatal("interruption lost persistent recovery records")
		}
		restartQueue()
		FlushQueue()
		assertRows(first)
		assertRows(second)
		assertRows(live)
		if len(operationQueue) != 0 || len(loadIndexQueue()) != 0 {
			t.Fatal("successful recovery left pending operations")
		}
	})

	t.Run("unreadable source is retained", func(t *testing.T) {
		ClearQueue()
		tree := newTree()
		IndexTreeQueue(tree)
		file := filepath.Join(util.DataDir, box, tree.Path)
		original, err := os.ReadFile(file)
		if err != nil {
			t.Fatal(err)
		}
		cache.RemoveTreeDataInBox(tree.ID, box)
		if err = os.WriteFile(file, []byte("invalid document"), 0644); err != nil {
			t.Fatal(err)
		}
		restartQueue()
		queuePath := filepath.Join(util.QueueDir, "index.queue")
		before, _ := os.ReadFile(queuePath)
		FlushQueue()
		after, _ := os.ReadFile(queuePath)
		if len(operationQueue) != 1 || !bytes.Equal(before, after) {
			t.Fatal("unreadable document lost its recovery record")
		}
		if err = os.WriteFile(file, original, 0644); err != nil {
			t.Fatal(err)
		}
		FlushQueue()
		assertRows(tree)
	})

	t.Run("coalesced moves recover the final document location", func(t *testing.T) {
		ClearQueue()
		tree := newTree()
		IndexTreeQueue(tree)
		FlushQueue()
		for _, parent := range []string{"20261026000000-parent1", "20261026000000-parent2"} {
			previous := filepath.Join(util.DataDir, box, tree.Path)
			latest := *tree
			latest.Path = "/" + parent + "/" + tree.ID + ".sy"
			latest.HPath = "/" + parent + "/Recovery"
			cache.RemoveTreeDataInBox(tree.ID, box)
			if _, err := filesys.WriteTree(&latest); err != nil {
				t.Fatal(err)
			}
			if err := os.Remove(previous); err != nil {
				t.Fatal(err)
			}
			treenode.IndexBlockTree(&latest)
			MoveTreeQueue(&latest)
			tree = &latest
		}
		if len(operationQueue) != 1 || len(loadIndexQueue()) != 2 {
			t.Fatal("coalesced move did not persist both recovery locations")
		}
		restartQueue()
		FlushQueue()
		assertRows(tree)
		var mismatches int
		if err := db.QueryRow("SELECT COUNT(*) FROM blocks WHERE root_id = ? AND (path != ? OR hpath != ?)", tree.ID, tree.Path, tree.HPath).Scan(&mismatches); err != nil || mismatches != 0 {
			t.Fatalf("recovery retained an obsolete path: %d, %v", mismatches, err)
		}
		if len(operationQueue) != 0 || len(loadIndexQueue()) != 0 {
			t.Fatal("move recovery did not checkpoint journal")
		}
	})

	t.Run("moved definition refs recover without reading reference documents", func(t *testing.T) {
		ClearQueue()
		source, target, reference := newTree(), newTree(), newTree()
		moved := source.Root.LastChild
		reference.Root.LastChild.AppendChild(&ast.Node{Type: ast.NodeTextMark, TextMarkType: "block-ref",
			TextMarkBlockRefID: moved.ID, TextMarkBlockRefSubtype: "s", TextMarkTextContent: "reference"})
		if _, err := filesys.WriteTree(reference); err != nil {
			t.Fatal(err)
		}
		for _, tree := range []*parse.Tree{source, target, reference} {
			treenode.IndexBlockTree(tree)
			IndexTreeQueue(tree)
		}
		FlushQueue()
		if refs := GetRefsCacheByDefIDInBox(moved.ID, box); len(refs) != 1 || refs[0].DefBlockRootID != source.ID {
			t.Fatalf("missing initial reference: %+v", refs)
		}
		moved.Unlink()
		target.Root.AppendChild(moved)
		for _, tree := range []*parse.Tree{source, target} {
			if _, err := filesys.WriteTree(tree); err != nil {
				t.Fatal(err)
			}
			treenode.IndexBlockTree(tree)
			UpsertTreeQueue(tree)
		}
		RefreshDefinitionRefsQueue(box, []string{moved.ID})
		// The queued metadata repair must not depend on loading this source.
		if err := os.WriteFile(filepath.Join(util.DataDir, box, reference.Path), []byte("unreadable reference document"), 0644); err != nil {
			t.Fatal(err)
		}
		restartQueue()
		if _, err := db.Exec("CREATE TRIGGER reject_ref_location BEFORE UPDATE ON refs BEGIN SELECT RAISE(ABORT, 'reject ref location'); END"); err != nil {
			t.Fatal(err)
		}
		FlushQueue()
		if len(operationQueue) != 1 || len(loadIndexQueue()) != 3 {
			t.Fatal("failed reference repair lost its recovery record")
		}
		if _, err := db.Exec("DROP TRIGGER reject_ref_location"); err != nil {
			t.Fatal(err)
		}
		restartQueue()
		FlushQueue()
		refs := GetRefsCacheByDefIDInBox(moved.ID, box)
		if len(refs) != 1 || refs[0].DefBlockRootID != target.ID || refs[0].DefBlockPath != target.Path || refs[0].DefBlockParentID != target.ID {
			t.Fatalf("recovery did not repair moved definition metadata: %+v", refs)
		}
		if len(operationQueue) != 0 || len(loadIndexQueue()) != 0 {
			t.Fatal("successful reference recovery left pending work")
		}
	})

	for _, recovered := range []bool{false, true} {
		name := "live"
		if recovered {
			name = "recovered"
		}
		t.Run(name+" failed transaction is retried in order", func(t *testing.T) {
			ClearQueue()
			first, second := newTree(), newTree()
			IndexTreeQueue(first)
			IndexTreeQueue(second)
			if recovered {
				restartQueue()
			}
			if _, err := db.Exec("CREATE TRIGGER reject_index BEFORE INSERT ON blocks BEGIN SELECT RAISE(ABORT, 'reject index'); END"); err != nil {
				t.Fatal(err)
			}
			FlushQueue()
			if len(operationQueue) != 2 || len(loadIndexQueue()) != 2 {
				t.Fatal("failed transaction discarded pending recovery")
			}
			if _, err := db.Exec("DROP TRIGGER reject_index"); err != nil {
				t.Fatal(err)
			}
			FlushQueue()
			assertRows(first)
			assertRows(second)
		})
	}

	t.Run("live begin failure retains ordered work beyond three retries", func(t *testing.T) {
		ClearQueue()
		first, second := newTree(), newTree()
		IndexTreeQueue(first)
		IndexTreeQueue(second)
		workingDB := db
		closedDB, err := stdsql.Open("sqlite3", ":memory:")
		if err != nil {
			t.Fatal(err)
		}
		closedDB.Close()
		db = closedDB
		defer func() { db = workingDB }()
		for range 5 {
			FlushQueue()
			if len(operationQueue) != 2 || operationQueue[0].indexTree != first || operationQueue[1].indexTree != second || len(loadIndexQueue()) != 2 {
				t.Fatal("begin failure lost, reordered or duplicated pending work")
			}
		}
		db = workingDB
		FlushQueue()
		assertRows(first)
		assertRows(second)
		if len(operationQueue) != 0 || len(loadIndexQueue()) != 0 {
			t.Fatal("successful retry left pending work")
		}
	})

	t.Run("live commit failure preserves journal until retry", func(t *testing.T) {
		ClearQueue()
		tree := newTree()
		// A deferred foreign key fails at COMMIT after all indexing statements
		// succeeded, exercising a different path from statement failure.
		db.SetMaxOpenConns(1)
		defer db.SetMaxOpenConns(20)
		for _, stmt := range []string{
			"PRAGMA foreign_keys = ON",
			"CREATE TABLE index_test_parent (id TEXT PRIMARY KEY)",
			"CREATE TABLE index_test_child (id TEXT REFERENCES index_test_parent(id) DEFERRABLE INITIALLY DEFERRED)",
			"CREATE TRIGGER fail_index_commit AFTER INSERT ON blocks BEGIN INSERT INTO index_test_child VALUES (NEW.id); END",
		} {
			if _, err := db.Exec(stmt); err != nil {
				t.Fatal(err)
			}
		}
		defer db.Exec("PRAGMA foreign_keys = OFF")
		IndexTreeQueue(tree)
		FlushQueue()
		if len(operationQueue) != 1 || len(loadIndexQueue()) != 1 {
			t.Fatal("commit failure discarded live operation or journal")
		}
		var rows int
		if err := db.QueryRow("SELECT COUNT(*) FROM blocks WHERE root_id = ?", tree.ID).Scan(&rows); err != nil || rows != 0 {
			t.Fatalf("failed commit retained partial data: %d, %v", rows, err)
		}
		if _, err := db.Exec("DROP TRIGGER fail_index_commit"); err != nil {
			t.Fatal(err)
		}
		FlushQueue()
		assertRows(tree)
		if len(operationQueue) != 0 || len(loadIndexQueue()) != 0 {
			t.Fatal("successful commit did not checkpoint journal")
		}
	})

	for _, action := range []string{"delete", "delete_id", "delete_ids", "rename", "rename_doc", "move", "delete_box"} {
		t.Run(action+" auxiliary failure rolls back and retries", func(t *testing.T) {
			ClearQueue()
			tree := newTree()
			IndexTreeQueue(tree)
			FlushQueue()
			if _, err := db.Exec("INSERT INTO block_embeddings (id, root_id, box, path) VALUES (?, ?, ?, ?)", tree.ID, tree.ID, box, tree.Path); err != nil {
				t.Fatal(err)
			}
			verb := "DELETE"
			if action == "rename" || action == "rename_doc" || action == "move" {
				verb = "UPDATE"
			}
			if _, err := db.Exec("CREATE TRIGGER reject_embedding BEFORE " + verb + " ON block_embeddings BEGIN SELECT RAISE(ABORT, 'reject embedding'); END"); err != nil {
				t.Fatal(err)
			}
			latest := *tree
			latest.HPath = "/Updated"
			if action == "move" {
				latest.Path = "/20261026000000-parent1/" + tree.ID + ".sy"
			}
			treenode.IndexBlockTree(&latest)
			op := &dbQueueOperation{action: action, indexTree: &latest, box: box,
				removeTreeBox: box, removeTreePath: tree.Path, removeTreeID: tree.ID, removeTreeIDs: []string{tree.ID}}
			appendOperation(op)
			FlushQueue()
			if len(operationQueue) != 1 || len(loadIndexQueue()) != 1 {
				t.Fatal("auxiliary SQL failure was acknowledged as success")
			}
			assertRows(tree)
			var hpath string
			if err := db.QueryRow("SELECT hpath FROM blocks WHERE id = ?", tree.ID).Scan(&hpath); err != nil || hpath != tree.HPath {
				t.Fatalf("failed auxiliary SQL committed primary changes: %q, %v", hpath, err)
			}
			if _, err := db.Exec("DROP TRIGGER reject_embedding"); err != nil {
				t.Fatal(err)
			}
			FlushQueue()
			if len(operationQueue) != 0 || len(loadIndexQueue()) != 0 {
				t.Fatal("successful auxiliary retry left pending work")
			}
			var rows int
			if err := db.QueryRow("SELECT COUNT(*) FROM block_embeddings WHERE root_id = ?", tree.ID).Scan(&rows); err != nil {
				t.Fatal(err)
			}
			if verb == "DELETE" && rows != 0 || verb == "UPDATE" && rows != 1 {
				t.Fatalf("incorrect auxiliary state after retry: %d rows", rows)
			}
		})
	}

	t.Run("embed content is recalculated and searchable after restart", func(t *testing.T) {
		ClearQueue()
		tree := newTree()
		source := tree.Root.LastChild
		embed := &ast.Node{ID: ast.NewNodeID(), Type: ast.NodeBlockQueryEmbed}
		embed.AppendChild(&ast.Node{Type: ast.NodeBlockQueryEmbedScript, Tokens: []byte("select * from blocks where id='" + source.ID + "'")})
		tree.Root.AppendChild(embed)
		if _, err := filesys.WriteTree(tree); err != nil {
			t.Fatal(err)
		}
		treenode.IndexBlockTree(tree)
		IndexTreeQueue(tree)
		FlushQueue()
		block, _ := buildBlockFromNode(embed, tree)
		var sourceContent string
		if err := db.QueryRow("SELECT content FROM blocks WHERE id = ?", source.ID).Scan(&sourceContent); err != nil || sourceContent != "recovery content" {
			t.Fatalf("missing recovery query source: id=%s content=%q err=%v", source.ID, sourceContent, err)
		}
		if content, supported := CalculateEmbedBlockContent(block); !supported || content != sourceContent {
			t.Fatalf("query calculation failed before recovery: markdown=%q content=%q supported=%v", block.Markdown, content, supported)
		}
		block.Content = "old stale result"
		UpdateBlockContentQueue(block)
		FlushQueue()
		block.Content = "uncommitted result"
		UpdateBlockContentQueue(block)
		restartQueue()
		FlushQueue()
		var content string
		if err := db.QueryRow("SELECT content FROM blocks WHERE id = ?", embed.ID).Scan(&content); err != nil || content != "recovery content" {
			t.Fatalf("embed recovery indexed script or stale content: %q, %v", content, err)
		}
		var matches int
		if err := db.QueryRow("SELECT COUNT(*) FROM blocks_fts WHERE blocks_fts MATCH 'recovery' AND id = ?", embed.ID).Scan(&matches); err != nil || matches != 1 {
			t.Fatalf("recovered embed is not searchable: %d, %v", matches, err)
		}
		if len(loadIndexQueue()) != 0 {
			t.Fatal("completed embed recovery was not checkpointed")
		}

		for _, script := range []string{"//!js return [];", "select * from blocks where id='missing'"} {
			embed.FirstChild.Tokens = []byte(script)
			cache.RemoveTreeDataInBox(tree.ID, box)
			if _, err := filesys.WriteTree(tree); err != nil {
				t.Fatal(err)
			}
			block.Content = "stale result"
			UpdateBlockContentQueue(block)
			restartQueue()
			FlushQueue()
			want := "no query result"
			if strings.HasPrefix(script, "//!js") {
				want = ""
			}
			if err := db.QueryRow("SELECT content FROM blocks WHERE id = ?", embed.ID).Scan(&content); err != nil || content != want {
				t.Fatalf("unsupported or empty embed recovery: %q, %v", content, err)
			}
		}
	})

	for _, recovered := range []bool{false, true} {
		name := "live"
		if recovered {
			name = "recovered"
		}
		t.Run(name+" locked notebook does not block ordinary documents", func(t *testing.T) {
			ClearQueue()
			isEncrypted := IsEncryptedBoxFn
			defer func() { IsEncryptedBoxFn = isEncrypted }()
			lockedBox := "20260922000000-locked1"
			IsEncryptedBoxFn = func(id string) bool { return id == lockedBox }
			DeleteBoxQueue(lockedBox)
			tree := newTree()
			IndexTreeQueue(tree)
			if recovered {
				restartQueue()
			}
			FlushQueue()
			assertRows(tree)
			if len(operationQueue) != 0 || len(loadIndexQueue()) != 0 {
				t.Fatal("obsolete locked notebook index blocked recovery")
			}
		})
	}
}
