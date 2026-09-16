//go:build fts5

package model

import (
	"bytes"
	"context"
	gosql "database/sql"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestDocumentHPathRefreshLifecycle(t *testing.T) {
	if os.Getenv("SIYUAN_TEST_HPATH_LIFECYCLE") != "1" {
		ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
		defer cancel()
		cmd := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestDocumentHPathRefreshLifecycle$", "-test.v")
		cmd.Env = append(os.Environ(), "SIYUAN_TEST_HPATH_LIFECYCLE=1")
		if output, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("hpath lifecycle subprocess: %v\n%s", err, output)
		}
		return
	}
	newFixture := func(t *testing.T) (*Box, *parse.Tree) {
		prepareHPathRefreshTest(t)
		box := &Box{ID: ast.NewNodeID()}
		bc := conf.NewBoxConf()
		bc.Name, bc.Closed = "Lifecycle", false
		if err := box.SaveConf(bc); err != nil {
			t.Fatal(err)
		}
		tree := newHPathTestDoc(t, box.ID, "/", "Parent", 1)
		newHPathTestDoc(t, box.ID, tree.Path, "Child", 32)
		sql.FlushQueue()
		if err := RenameDoc(box.ID, tree.Path, "Renamed"); err != nil {
			t.Fatal(err)
		}
		sql.FlushQueue()
		if len(hpathRefresh.tasks) != 1 {
			t.Fatal("ordinary index flush discarded the pending hpath task")
		}
		return box, tree
	}
	resetMemory := func() {
		hpathRefresh.tasks, hpathRefresh.file = nil, ""
	}
	assertCleared := func(t *testing.T) {
		t.Helper()
		if len(hpathRefresh.tasks) != 0 {
			t.Fatalf("pending tasks remain: %v", hpathRefresh.tasks)
		}
		for _, p := range []string{filepath.Join(util.ConfDir, "hpath-refresh.json"), filepath.Join(util.QueueDir, "hpath-refresh.queue")} {
			if _, err := os.Stat(p); !os.IsNotExist(err) {
				t.Fatalf("queue remains at %s: %v", p, err)
			}
		}
		RefreshHPathsJob()
		resetMemory()
		if err := loadHPathRefreshLocked(); err != nil || len(hpathRefresh.tasks) != 0 {
			t.Fatalf("cleared tasks resurrected: %v", err)
		}
	}

	t.Run("legacy migration and interrupted merge", func(t *testing.T) {
		box, tree := newFixture(t)
		legacy := filepath.Join(util.ConfDir, "hpath-refresh.json")
		queue := filepath.Join(util.QueueDir, "hpath-refresh.queue")
		original, err := os.ReadFile(queue)
		if err != nil {
			t.Fatal(err)
		}
		if err = os.WriteFile(legacy, original, 0600); err != nil {
			t.Fatal(err)
		}
		if err = os.Remove(queue); err != nil {
			t.Fatal(err)
		}
		resetMemory()
		if err = loadHPathRefreshLocked(); err != nil {
			t.Fatal(err)
		}
		migrated, err := os.ReadFile(queue)
		if err != nil || !bytes.Equal(original, migrated) {
			t.Fatalf("migration changed persisted entries: %v", err)
		}
		if _, err = os.Stat(legacy); !os.IsNotExist(err) {
			t.Fatalf("legacy file remains: %v", err)
		}
		second := newHPathTestDoc(t, box.ID, "/", "Second", 1)
		if err = RenameDoc(box.ID, second.Path, "SecondRenamed"); err != nil {
			t.Fatal(err)
		}
		// 模拟目标文件已写入、来源文件尚未删除时进程中断，两个文件都必须合并。
		if err = os.WriteFile(legacy, original, 0600); err != nil {
			t.Fatal(err)
		}
		legacyTasks, _, err := readHPathRefreshTasks(legacy)
		if err != nil {
			t.Fatal(err)
		}
		stale := *hpathRefresh.tasks[box.ID+"/"+second.ID]
		stale.Path = "/" + tree.ID + "/" + second.ID + ".sy"
		legacyTasks[box.ID+"/"+second.ID] = &stale
		if err = writeHPathRefreshTasks(legacy, legacyTasks); err != nil {
			t.Fatal(err)
		}
		if err = writeHPathRefreshTasks(queue, map[string]*hpathRefreshTask{box.ID + "/" + second.ID: hpathRefresh.tasks[box.ID+"/"+second.ID]}); err != nil {
			t.Fatal(err)
		}
		resetMemory()
		if err = loadHPathRefreshLocked(); err != nil || len(hpathRefresh.tasks) != 2 {
			t.Fatalf("migration lost pending tasks: %v", err)
		}
		if hpathRefresh.tasks[box.ID+"/"+second.ID].Path != second.Path {
			t.Fatal("legacy duplicate replaced the destination entry")
		}
		drainHPathRefreshTest(t)
		db, err := gosql.Open("sqlite3_extended", util.DBPath)
		if err != nil {
			t.Fatal(err)
		}
		defer db.Close()
		assertHPathTestDoc(t, db, tree, "/Renamed")
		assertHPathTestDoc(t, db, second, "/SecondRenamed")
		assertCleared(t)
	})

	t.Run("failed migration preserves records", func(t *testing.T) {
		newFixture(t)
		legacy := filepath.Join(util.ConfDir, "hpath-refresh.json")
		queue := filepath.Join(util.QueueDir, "hpath-refresh.queue")
		original, err := os.ReadFile(queue)
		if err != nil {
			t.Fatal(err)
		}
		if err = os.WriteFile(legacy, original, 0600); err != nil {
			t.Fatal(err)
		}
		if err = os.Remove(queue); err != nil {
			t.Fatal(err)
		}
		if err = os.Mkdir(queue, 0755); err != nil {
			t.Fatal(err)
		}
		resetMemory()
		if err = loadHPathRefreshLocked(); err == nil {
			t.Fatal("unwritable migration destination was accepted")
		}
		data, err := os.ReadFile(legacy)
		if err != nil || !bytes.Equal(data, original) {
			t.Fatalf("failed migration changed source: %v", err)
		}
		if err = os.Remove(queue); err != nil {
			t.Fatal(err)
		}
		if err = loadHPathRefreshLocked(); err != nil || len(hpathRefresh.tasks) != 1 {
			t.Fatalf("migration retry failed: %v", err)
		}
	})

	t.Run("unknown or corrupt records remain intact", func(t *testing.T) {
		newFixture(t)
		legacy := filepath.Join(util.ConfDir, "hpath-refresh.json")
		queue := filepath.Join(util.QueueDir, "hpath-refresh.queue")
		valid, err := os.ReadFile(queue)
		if err != nil {
			t.Fatal(err)
		}
		for _, data := range [][]byte{[]byte(`{"version":99,"tasks":[]}`), []byte(`{"version":1,"tasks":`)} {
			if err = os.WriteFile(legacy, data, 0600); err != nil {
				t.Fatal(err)
			}
			resetMemory()
			if err = loadHPathRefreshLocked(); err == nil {
				t.Fatal("invalid record accepted")
			}
			preserved, err := os.ReadFile(legacy)
			if err != nil || !bytes.Equal(data, preserved) {
				t.Fatalf("invalid source was changed: %v", err)
			}
			preserved, err = os.ReadFile(queue)
			if err != nil || !bytes.Equal(valid, preserved) {
				t.Fatalf("valid destination was changed: %v", err)
			}
		}
	})

	t.Run("covered task can be replaced", func(t *testing.T) {
		box, tree := newFixture(t)
		child := treenode.GetBlockTreeRootByHPath(box.ID, "/Renamed/Child")
		if child == nil {
			t.Fatal("child metadata missing")
		}
		if err := RenameDoc(box.ID, child.Path, "Leaf"); err != nil {
			t.Fatal(err)
		}
		sql.FlushQueue()
		parentTask := hpathRefresh.tasks[box.ID+"/"+tree.ID]
		childTask := hpathRefresh.tasks[box.ID+"/"+child.ID]
		if _, err := refreshHPathsTask(parentTask); err != nil {
			t.Fatal(err)
		}
		if childTask.coveredBy != parentTask {
			t.Fatal("parent did not cover child task")
		}
		if err := RenameDoc(box.ID, child.Path, "FinalLeaf"); err != nil {
			t.Fatal(err)
		}
		replacement := hpathRefresh.tasks[box.ID+"/"+child.ID]
		if replacement == childTask || replacement.coveredBy != nil || parentTask.covers != nil {
			t.Fatal("replacement inherited stale coverage")
		}
		drainHPathRefreshTest(t)
		if got := treenode.GetBlockTreeRootByHPath(box.ID, "/Renamed/FinalLeaf"); got == nil || got.ID != child.ID {
			t.Fatal("replacement was not completed")
		}
		assertCleared(t)
	})

	for _, force := range []bool{true, false} {
		name := "forced rebuild"
		if !force {
			name = "schema rebuild"
		}
		t.Run(name, func(t *testing.T) {
			box, _ := newFixture(t)
			if !force {
				db, err := gosql.Open("sqlite3_extended", util.DBPath)
				if err != nil {
					t.Fatal(err)
				}
				_, err = db.Exec("UPDATE stat SET value = 'obsolete'")
				db.Close()
				if err != nil {
					t.Fatal(err)
				}
			}
			reset := sql.ResetHPathRefreshQueue
			checked := false
			sql.ResetHPathRefreshQueue = func() error {
				checked = true
				for _, check := range []struct{ file, table string }{{util.DBPath, "blocks"}, {util.BlockTreeDBPath, "blocktrees"}} {
					db, err := gosql.Open("sqlite3_extended", check.file)
					if err != nil {
						return err
					}
					var count int
					err = db.QueryRow("SELECT COUNT(*) FROM " + check.table).Scan(&count)
					db.Close()
					if err != nil {
						return err
					}
					if count != 0 {
						t.Errorf("recovery was cleared before invalidating %s", check.table)
					}
				}
				return reset()
			}
			defer func() { sql.ResetHPathRefreshQueue = reset }()
			sql.InitDatabase(force)
			if !checked {
				t.Fatal("rebuild did not invoke recovery cleanup")
			}
			assertCleared(t)
			indexBox(box.ID)
			sql.FlushQueue()
			assertCleared(t)
		})
	}

	t.Run("rebuild waits for path writer", func(t *testing.T) {
		newFixture(t)
		hpathRefresh.Lock()
		done := make(chan struct{})
		go func() {
			sql.InitDatabase(true)
			close(done)
		}()
		select {
		case <-done:
			hpathRefresh.Unlock()
			t.Fatal("rebuild bypassed the path writer")
		case <-time.After(30 * time.Millisecond):
		}
		hpathRefresh.Unlock()
		select {
		case <-done:
		case <-time.After(5 * time.Second):
			t.Fatal("rebuild deadlocked with the path writer")
		}
		assertCleared(t)
	})

	t.Run("closed notebook resumes", func(t *testing.T) {
		box, tree := newFixture(t)
		Unmount(box.ID)
		RefreshHPathsJob()
		if len(hpathRefresh.tasks) != 1 {
			t.Fatal("closing notebook discarded pending recovery")
		}
		resetMemory()
		recoverDocHPaths()
		if len(hpathRefresh.tasks) != 1 {
			t.Fatal("restart discarded closed notebook recovery")
		}
		if _, err := Mount(box.ID); err != nil {
			t.Fatal(err)
		}
		indexBox(box.ID)
		drainHPathRefreshTest(t)
		db, err := gosql.Open("sqlite3_extended", util.DBPath)
		if err != nil {
			t.Fatal(err)
		}
		defer db.Close()
		assertHPathTestDoc(t, db, tree, "/Renamed")
		assertCleared(t)
	})

	t.Run("notebook deletion clears memory and file", func(t *testing.T) {
		box, _ := newFixture(t)
		Unmount(box.ID)
		if err := RemoveBox(box.ID); err != nil {
			t.Fatal(err)
		}
		assertCleared(t)
	})

	t.Run("missing notebook is pruned", func(t *testing.T) {
		box, _ := newFixture(t)
		Unmount(box.ID)
		p := filepath.Join(util.DataDir, box.ID)
		if err := os.Rename(p, p+"-removed"); err != nil {
			t.Fatal(err)
		}
		RefreshHPathsJob()
		assertCleared(t)
	})
}
