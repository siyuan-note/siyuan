//go:build fts5

package model

import (
	"bytes"
	"context"
	gosql "database/sql"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestDocumentHPathRefresh(t *testing.T) {
	if os.Getenv("SIYUAN_TEST_HPATH_REFRESH") != "1" {
		ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
		defer cancel()
		cmd := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestDocumentHPathRefresh$", "-test.v")
		cmd.Env = append(os.Environ(), "SIYUAN_TEST_HPATH_REFRESH=1")
		if output, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("hpath refresh subprocess: %v\n%s", err, output)
		}
		return
	}
	prepareHPathRefreshTest(t)
	box := &Box{ID: "20260915000000-hpath01"}
	boxConf := conf.NewBoxConf()
	boxConf.Name, boxConf.Closed = "HPath", false
	if err := box.SaveConf(boxConf); err != nil {
		t.Fatal(err)
	}
	database, err := gosql.Open("sqlite3_extended", util.DBPath)
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()

	parent := newHPathTestDoc(t, box.ID, "/", "Parent", 1)
	child := newHPathTestDoc(t, box.ID, parent.Path, "Child", 1400)
	grandchild := newHPathTestDoc(t, box.ID, child.Path, "Grandchild", 4)
	sibling := newHPathTestDoc(t, box.ID, "/", "Parent", 2)
	sql.FlushQueue()
	childFile := filepath.Join(util.DataDir, child.Box, child.Path)
	before, err := os.ReadFile(childFile)
	if err != nil {
		t.Fatal(err)
	}
	btDatabase, err := gosql.Open("sqlite3_extended", util.BlockTreeDBPath)
	if err != nil {
		t.Fatal(err)
	}
	defer btDatabase.Close()
	var beforeRowID int64
	if err = btDatabase.QueryRow("SELECT rowid FROM blocktrees WHERE id = ?", child.Root.FirstChild.ID).Scan(&beforeRowID); err != nil {
		t.Fatal(err)
	}

	t.Run("bounded writes and immediate document lookup", func(t *testing.T) {
		if err := RenameDoc(box.ID, parent.Path, "Renamed"); err != nil {
			t.Fatal(err)
		}
		if got := treenode.GetBlockTreeRootByHPath(box.ID, "/Renamed/Child"); got == nil || got.ID != child.ID {
			t.Fatalf("new child path is not immediately addressable: %#v", got)
		}
		if got := treenode.GetBlockTreeInBox(child.Root.FirstChild.ID, box.ID); got.HPath != "/Parent/Child" {
			t.Fatalf("content block path was eagerly rewritten: %q", got.HPath)
		}
		after, err := os.ReadFile(childFile)
		if err != nil || !bytes.Equal(before, after) {
			t.Fatalf("renaming parent changed descendant file: %v", err)
		}
		var afterRowID int64
		if err = btDatabase.QueryRow("SELECT rowid FROM blocktrees WHERE id = ?", child.Root.FirstChild.ID).Scan(&afterRowID); err != nil || beforeRowID != afterRowID {
			t.Fatalf("descendant blocktree was rebuilt: %d, %d, %v", beforeRowID, afterRowID, err)
		}
		doc := treenode.GetBlockTreeInBox(child.ID, box.ID)
		if _, _, _, busy, err := sql.RefreshHPathsBatch(doc, 0, 0, 64); err != nil || !busy {
			t.Fatalf("background did not yield to pending indexes: busy=%v err=%v", busy, err)
		}
		sql.FlushQueue()
		if _, _, done, busy, err := sql.RefreshHPathsBatch(doc, 0, 0, 64); err != nil || busy || done {
			t.Fatalf("bounded batch failed: done=%v busy=%v err=%v", done, busy, err)
		}
		var changed int
		if err = database.QueryRow("SELECT COUNT(*) FROM blocks WHERE root_id = ? AND hpath = ?", child.ID, "/Renamed/Child").Scan(&changed); err != nil || changed == 0 || changed > 64 {
			t.Fatalf("batch exceeded row budget: %d, %v", changed, err)
		}
		newID, err := createDocsByHPathSync(box.ID, "/Renamed/Child/Added", "", child.ID, ast.NewNodeID(), false)
		if err != nil {
			t.Fatal(err)
		}
		newDoc := treenode.GetBlockTreeInBox(newID, box.ID)
		if newDoc == nil || path.Dir(newDoc.Path) != strings.TrimSuffix(child.Path, ".sy") {
			t.Fatalf("path creation duplicated the parent: %#v", newDoc)
		}
	})

	t.Run("rename coalescing and stale queued edit", func(t *testing.T) {
		stale, err := filesys.LoadTree(box.ID, child.Path, util.NewLute())
		if err != nil {
			t.Fatal(err)
		}
		if err = RenameDoc(box.ID, parent.Path, "Final"); err != nil {
			t.Fatal(err)
		}
		if err = RenameDoc(box.ID, child.Path, "Leaf"); err != nil {
			t.Fatal(err)
		}
		stale.HPath = "/Parent/Child"
		sql.UpsertTreeQueue(stale)
		drainHPathRefreshTest(t)
		assertHPathTestDoc(t, database, child, "/Final/Leaf")
		assertHPathTestDoc(t, database, grandchild, "/Final/Leaf/Grandchild")
		assertHPathTestDoc(t, database, sibling, "/Parent")
	})

	t.Run("interrupted source writes and restart", func(t *testing.T) {
		for _, item := range []struct {
			doc   *parse.Tree
			title string
		}{{parent, "Recovered"}, {child, "RecoveredChild"}} {
			tree, err := filesys.LoadTree(box.ID, item.doc.Path, util.NewLute())
			if err != nil {
				t.Fatal(err)
			}
			tree.Root.SetIALAttr("title", item.title)
			tree.HPath = path.Join(path.Dir(tree.HPath), item.title)
			hpathRefresh.Lock()
			_, err = queueHPathRefreshLocked(tree)
			hpathRefresh.Unlock()
			if err != nil {
				t.Fatal(err)
			}
			if _, err = filesys.WriteTree(tree); err != nil {
				t.Fatal(err)
			}
		}
		hpathRefresh.Lock()
		hpathRefresh.tasks, hpathRefresh.file = nil, ""
		hpathRefresh.Unlock()
		recoverDocHPaths()
		if got := treenode.GetBlockTreeRootByHPath(box.ID, "/Recovered/RecoveredChild/Grandchild"); got == nil || got.ID != grandchild.ID {
			t.Fatalf("startup did not restore document metadata: %#v", got)
		}
		drainHPathRefreshTest(t)
		assertHPathTestDoc(t, database, grandchild, "/Recovered/RecoveredChild/Grandchild")
	})

	t.Run("failed content commit retains recovery", func(t *testing.T) {
		if err := RenameDoc(box.ID, parent.Path, "Retry"); err != nil {
			t.Fatal(err)
		}
		sql.FlushQueue()
		if _, err := database.Exec("CREATE TRIGGER fail_hpath BEFORE UPDATE OF hpath ON blocks BEGIN SELECT RAISE(ABORT, 'injected hpath failure'); END"); err != nil {
			t.Fatal(err)
		}
		doc := treenode.GetBlockTreeInBox(child.ID, box.ID)
		oldPath := treenode.GetBlockTreeInBox(child.Root.FirstChild.ID, box.ID).HPath
		if _, _, _, _, err := sql.RefreshHPathsBatch(doc, 0, 0, 64); err == nil {
			t.Fatal("injected commit failure was ignored")
		}
		if got := treenode.GetBlockTreeInBox(child.Root.FirstChild.ID, box.ID); got.HPath != oldPath {
			t.Fatal("blocktree batch was not rolled back")
		}
		if len(hpathRefresh.tasks) == 0 {
			t.Fatal("pending recovery was lost")
		}
		if _, err := database.Exec("DROP TRIGGER fail_hpath"); err != nil {
			t.Fatal(err)
		}
		drainHPathRefreshTest(t)
		assertHPathTestDoc(t, database, child, "/Retry/RecoveredChild")
	})

	t.Run("move delete and synced title", func(t *testing.T) {
		if err := RenameDoc(box.ID, parent.Path, "BeforeMove"); err != nil {
			t.Fatal(err)
		}
		destination := newHPathTestDoc(t, box.ID, "/", "Destination", 1)
		sql.FlushQueue()
		stale, err := filesys.LoadTree(box.ID, child.Path, util.NewLute())
		if err != nil {
			t.Fatal(err)
		}
		staleDoc := treenode.GetBlockTreeInBox(child.ID, box.ID)
		if err := MoveDocs([]string{box.ID + child.Path}, box.ID, destination.Path, nil); err != nil {
			t.Fatal(err)
		}
		moved := treenode.GetBlockTreeInBox(child.ID, box.ID)
		child.Path = moved.Path
		sql.RenameDocQueue(stale)
		sql.FlushQueue()
		assertHPathTestDoc(t, database, child, "/Destination/RecoveredChild")
		if err := treenode.RefreshDocHPaths(stale); err == nil {
			t.Fatal("stale recovery snapshot accepted after move")
		}
		if _, _, _, _, err := sql.RefreshHPathsBatch(staleDoc, 0, 0, 64); err == nil {
			t.Fatal("stale background batch accepted after move")
		}
		if err := RemoveDoc(box.ID, parent.Path); err != nil {
			t.Fatal(err)
		}
		tree, err := filesys.LoadTree(box.ID, destination.Path, util.NewLute())
		if err != nil {
			t.Fatal(err)
		}
		tree.Root.SetIALAttr("title", "Synced")
		if _, err = filesys.WriteTree(tree); err != nil {
			t.Fatal(err)
		}
		if ids := upsertIndexes([]string{box.ID + destination.Path}); len(ids) != 1 {
			t.Fatalf("sync did not index document: %v", ids)
		}
		drainHPathRefreshTest(t)
		assertHPathTestDoc(t, database, child, "/Synced/RecoveredChild")
	})

	t.Run("batch boundaries and independent cursors", func(t *testing.T) {
		for _, test := range []struct {
			name      string
			limit     int
			shortened string
		}{
			{"partial batch", 33, ""},
			{"exact batch", 32, ""},
			{"one row tail", 31, ""},
			{"exact multiple", 16, ""},
			{"content finishes first", 16, "blocks"},
			{"blocktree finishes first", 16, "blocktrees"},
		} {
			t.Run(test.name, func(t *testing.T) {
				tree := newHPathTestDoc(t, box.ID, "/", "Batch", 31)
				sql.FlushQueue()
				if test.shortened != "" {
					db := database
					if test.shortened == "blocktrees" {
						db = btDatabase
					}
					if _, err := db.Exec("DELETE FROM "+test.shortened+" WHERE rowid IN (SELECT rowid FROM "+test.shortened+" WHERE root_id = ? AND type != 'd' ORDER BY rowid DESC LIMIT 17)", tree.ID); err != nil {
						t.Fatal(err)
					}
				}
				if err := RenameDoc(box.ID, tree.Path, "BatchRenamed"); err != nil {
					t.Fatal(err)
				}
				sql.FlushQueue()
				doc := treenode.GetBlockTreeInBox(tree.ID, box.ID)
				var blockAfter, treeAfter int64
				for batch := 1; batch <= (32+test.limit-1)/test.limit; batch++ {
					nextBlock, nextTree, done, busy, err := sql.RefreshHPathsBatch(doc, blockAfter, treeAfter, test.limit)
					if err != nil || busy {
						t.Fatalf("batch %d failed: busy=%v err=%v", batch, busy, err)
					}
					if done != (batch == (32+test.limit-1)/test.limit) {
						t.Fatalf("batch %d has incorrect completion: %v", batch, done)
					}
					for _, cursor := range []struct {
						db          *gosql.DB
						table       string
						after, next int64
					}{{database, "blocks", blockAfter, nextBlock}, {btDatabase, "blocktrees", treeAfter, nextTree}} {
						var advanced, skipped, premature int
						if err = cursor.db.QueryRow("SELECT COUNT(*) FROM "+cursor.table+" WHERE root_id = ? AND rowid > ? AND rowid <= ?", tree.ID, cursor.after, cursor.next).Scan(&advanced); err != nil || cursor.next < cursor.after || advanced > test.limit {
							t.Fatalf("invalid %s cursor %d -> %d: rows=%d err=%v", cursor.table, cursor.after, cursor.next, advanced, err)
						}
						if err = cursor.db.QueryRow("SELECT COUNT(*) FROM "+cursor.table+" WHERE root_id = ? AND rowid <= ? AND hpath != ?", tree.ID, cursor.next, doc.HPath).Scan(&skipped); err != nil || skipped != 0 {
							t.Fatalf("batch skipped %s rows: %d, %v", cursor.table, skipped, err)
						}
						if err = cursor.db.QueryRow("SELECT COUNT(*) FROM "+cursor.table+" WHERE root_id = ? AND rowid > ? AND type != 'd' AND hpath = ?", tree.ID, cursor.next, doc.HPath).Scan(&premature); err != nil || premature != 0 {
							t.Fatalf("batch updated lookahead %s rows: %d, %v", cursor.table, premature, err)
						}
					}
					blockAfter, treeAfter = nextBlock, nextTree
				}
				assertHPathTestDoc(t, database, tree, "/BatchRenamed")
			})
		}
		drainHPathRefreshTest(t)
	})
}

func prepareHPathRefreshTest(t *testing.T) {
	root := t.TempDir()
	util.WorkspaceDir = root
	util.DataDir, util.TempDir, util.ConfDir = filepath.Join(root, "data"), filepath.Join(root, "temp"), filepath.Join(root, "conf")
	util.HistoryDir, util.QueueDir = filepath.Join(root, "history"), filepath.Join(util.TempDir, "queue")
	util.DBPath, util.BlockTreeDBPath = filepath.Join(util.TempDir, util.DBName), filepath.Join(util.TempDir, "blocktree.db")
	util.HistoryDBPath, util.AssetContentDBPath = filepath.Join(util.TempDir, "history.db"), filepath.Join(util.TempDir, "asset_content.db")
	for _, dir := range []string{util.DataDir, util.TempDir, util.ConfDir, util.HistoryDir, util.QueueDir} {
		if err := os.MkdirAll(dir, 0755); err != nil {
			t.Fatal(err)
		}
	}
	Conf = NewAppConf()
	Conf.FileTree, Conf.NotebookCrypto, Conf.Sync = conf.NewFileTree(), conf.NewNotebookCrypto(), conf.NewSync()
	Conf.Editor, Conf.Export, Conf.Search = conf.NewEditor(), conf.NewExport(), conf.NewSearch()
	Conf.Lang, util.Lang = "en", "en"
	util.StatusBarCfg = util.NewStatusBar(false)
	util.WorkingDir, _ = filepath.Abs(filepath.Join("..", "..", "app"))
	initLang()
	sql.InitDatabase(true)
	sql.InitHistoryDatabase(true)
	sql.InitAssetContentDatabase(true)
	t.Cleanup(sql.CloseDatabase)
	util.SetBooted()
}

func newHPathTestDoc(t *testing.T, box, parentPath, title string, blocks int) *parse.Tree {
	id := ast.NewNodeID()
	p := path.Join(strings.TrimSuffix(parentPath, ".sy"), id+".sy")
	hpath := "/" + title
	if parentPath != "/" {
		parent := treenode.GetBlockTreeInBox(util.GetTreeID(parentPath), box)
		hpath = parent.HPath + "/" + title
	}
	tree := treenode.NewTree(box, p, hpath, title)
	for i := 1; i < blocks; i++ {
		tree.Root.AppendChild(treenode.NewParagraph("hpath refresh regression"))
	}
	if err := os.MkdirAll(filepath.Dir(filepath.Join(util.DataDir, box, p)), 0755); err != nil {
		t.Fatal(err)
	}
	if err := indexWriteTreeIndexQueue(tree); err != nil {
		t.Fatal(err)
	}
	return tree
}

func drainHPathRefreshTest(t *testing.T) {
	t.Helper()
	deadline := time.Now().Add(30 * time.Second)
	for time.Now().Before(deadline) {
		sql.FlushQueue()
		hpathRefresh.Lock()
		pending := len(hpathRefresh.tasks)
		for _, task := range hpathRefresh.tasks {
			task.due = time.Time{}
		}
		hpathRefresh.Unlock()
		if pending == 0 {
			return
		}
		RefreshHPathsJob()
	}
	t.Fatalf("hpath refresh did not finish: %#v", hpathRefresh.tasks)
}

func assertHPathTestDoc(t *testing.T, database *gosql.DB, tree *parse.Tree, expected string) {
	t.Helper()
	var total, wrong int
	if err := database.QueryRow("SELECT COUNT(*), COALESCE(SUM(hpath != ?), 0) FROM blocks WHERE root_id = ? AND box = ?", expected, tree.ID, tree.Box).Scan(&total, &wrong); err != nil || total == 0 || wrong != 0 {
		t.Fatalf("content paths for %s: total=%d wrong=%d expected=%s err=%v", tree.ID, total, wrong, expected, err)
	}
	for _, bt := range treenode.GetBlockTreesByRootIDInBox(tree.ID, tree.Box) {
		if bt.HPath != expected {
			t.Fatalf("blocktree path for %s: %s, expected %s", bt.ID, bt.HPath, expected)
		}
	}
}
