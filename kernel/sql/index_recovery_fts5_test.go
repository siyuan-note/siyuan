//go:build fts5

package sql

import (
	"bytes"
	"context"
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

	t.Run("failed transaction is retried in order", func(t *testing.T) {
		ClearQueue()
		first, second := newTree(), newTree()
		IndexTreeQueue(first)
		IndexTreeQueue(second)
		restartQueue()
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

	t.Run("locked notebook recovery does not block ordinary documents", func(t *testing.T) {
		ClearQueue()
		isEncrypted := IsEncryptedBoxFn
		defer func() { IsEncryptedBoxFn = isEncrypted }()
		lockedBox := "20260922000000-locked1"
		IsEncryptedBoxFn = func(id string) bool { return id == lockedBox }
		DeleteBoxQueue(lockedBox)
		tree := newTree()
		IndexTreeQueue(tree)
		restartQueue()
		FlushQueue()
		assertRows(tree)
		if len(operationQueue) != 0 || len(loadIndexQueue()) != 0 {
			t.Fatal("obsolete locked notebook index blocked recovery")
		}
	})
}
