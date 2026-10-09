//go:build fts5

package model

import (
	"database/sql"
	"os"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/conf"
	index "github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/task"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// TestRapidDeletionLargeIndex 按需构造大索引，交叠运行删除、查询与后台任务；不创建等量的源文档。
// SIYUAN_DELETE_STRESS_BLOCKS 指定填充块数，未设置时跳过，避免普通回归测试产生大量磁盘写入。
func TestRapidDeletionLargeIndex(t *testing.T) {
	value := os.Getenv("SIYUAN_DELETE_STRESS_BLOCKS")
	if value == "" {
		t.Skip("set SIYUAN_DELETE_STRESS_BLOCKS to run the large index diagnostic")
	}
	count, err := strconv.Atoi(value)
	if err != nil || count < 1 || count > 2000000 {
		t.Fatal("SIYUAN_DELETE_STRESS_BLOCKS must be between 1 and 2000000")
	}
	f := setupStructureTransactionTest(t)
	setupFoldTransactionDatabase(t, f)
	Conf.Search = conf.NewSearch()
	source, err := LoadTreeByBlockID(f.sourceID)
	if err != nil {
		t.Fatal(err)
	}
	var blockIDs []string
	for range 30 {
		p := treenode.NewParagraph(ast.NewNodeID())
		p.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("delete text")})
		source.Root.AppendChild(p)
		blockIDs = append(blockIDs, p.ID)
	}
	if err = indexWriteTreeIndexQueue(source); err != nil {
		t.Fatal(err)
	}
	var targets []*parse.Tree
	for range 30 {
		tree := treenode.NewTree(f.box.ID, "/"+ast.NewNodeID()+".sy", "/Delete target", "Delete target")
		tree.Root.FirstChild.AppendChild(&ast.Node{Type: ast.NodeTextMark, TextMarkType: "block-ref",
			TextMarkBlockRefID: f.childID, TextMarkBlockRefSubtype: "s", TextMarkTextContent: "Reference"})
		if err = indexWriteTreeIndexQueue(tree); err != nil {
			t.Fatal(err)
		}
		child := treenode.NewTree(f.box.ID, strings.TrimSuffix(tree.Path, ".sy")+"/"+ast.NewNodeID()+".sy", "/Delete target/Child", "Child")
		if err = indexWriteTreeIndexQueue(child); err != nil {
			t.Fatal(err)
		}
		targets = append(targets, tree)
	}
	index.FlushQueue()
	seedStart := time.Now()
	db, err := sql.Open("sqlite3_extended", util.DBPath+"?_journal_mode=WAL&_synchronous=OFF&_busy_timeout=7000")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	// 填充记录只用于复现扫描成本，真实删除目标仍由文档写入与索引入口创建。
	_, err = db.Exec(`WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x < ?)
		INSERT INTO blocks (id,parent_id,root_id,box,path,hpath,type,content,fcontent,markdown,ial)
		SELECT printf('seed-%d',x),printf('seed-root-%d',x/30),printf('seed-root-%d',x/30),?,
		printf('/seed/%d.sy',x/30),'/Seed','p',?,'','','' FROM n`, count, f.box.ID, strings.Repeat("content ", 64))
	if err != nil {
		t.Fatal(err)
	}
	for _, statement := range []string{
		"INSERT INTO attributes (id,name,value,root_id,box,path) SELECT id,'custom-test','value',root_id,box,path FROM blocks WHERE id LIKE 'seed-%'",
		"INSERT INTO spans (id,root_id,box,path,content) SELECT id,root_id,box,path,'span' FROM blocks WHERE id LIKE 'seed-%' AND rowid%6=0",
		"INSERT INTO refs (id,def_block_id,def_block_root_id,root_id,box,path) SELECT id,'seed-definition','seed-definition',root_id,box,path FROM blocks WHERE id LIKE 'seed-%' AND rowid%10=0",
		"INSERT INTO assets (id,root_id,box,docpath,path) SELECT id,root_id,box,path,'assets/test.png' FROM blocks WHERE id LIKE 'seed-%' AND rowid%30=0",
		"INSERT INTO blocks_fts(blocks_fts) VALUES('rebuild')",
	} {
		start := time.Now()
		if _, err = db.Exec(statement); err != nil {
			t.Fatal(err)
		}
		t.Logf("seed stage %s: %s", strings.Fields(statement)[2], time.Since(start))
	}
	if _, err = db.Exec("PRAGMA wal_checkpoint(TRUNCATE)"); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(util.DBPath)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("seeded %d blocks, database %.1f MiB, elapsed %s", count, float64(info.Size())/1048576, time.Since(seedStart))

	stop := make(chan struct{})
	var workers sync.WaitGroup
	startWorker := func(interval time.Duration, run func()) {
		workers.Add(1)
		go func() {
			defer workers.Done()
			ticker := time.NewTicker(interval)
			defer ticker.Stop()
			for {
				select {
				case <-stop:
					return
				case <-ticker.C:
					run()
				}
			}
		}()
	}
	startWorker(100*time.Millisecond, task.ExecTaskJob)
	startWorker(100*time.Millisecond, task.ExecAsyncTaskJob)
	startWorker(util.SQLFlushInterval, index.FlushTxJob)
	startWorker(100*time.Millisecond, func() { _, _ = GetDocInfo(f.sourceID) })
	defer func() {
		close(stop)
		workers.Wait()
		index.FlushQueue()
		// 等待已经派发的短延迟引用计数任务结束后再释放测试数据库。
		time.Sleep(time.Second)
	}()
	textDone := make(chan error, 1)
	go func() {
		for _, id := range blockIDs {
			if err := PerformTxSync(&Transaction{DoOperations: []*Operation{{Action: "delete", ID: id}}}); err != nil {
				textDone <- err
				return
			}
			time.Sleep(100 * time.Millisecond)
		}
		textDone <- nil
	}()
	start := time.Now()
	for i, tree := range targets {
		deletionStart := time.Now()
		if err := RemoveDoc(f.box.ID, tree.Path); err != nil {
			t.Fatal(err)
		}
		t.Logf("delete %d: %s", i+1, time.Since(deletionStart))
		if (i+1)%3 == 0 {
			logStart := time.Now()
			if err := writeSystemGoroutineLog(util.TempDir); err != nil {
				t.Fatal(err)
			}
			t.Logf("stack capture: %s", time.Since(logStart))
		}
	}
	if err := <-textDone; err != nil {
		t.Fatal(err)
	}
	FlushTxQueue()
	flushStart := time.Now()
	index.FlushQueue()
	t.Logf("final flush: %s, total deletion time: %s", time.Since(flushStart), time.Since(start))
	for _, tree := range targets {
		assertDatabaseBlockExists(t, tree.ID, false)
		if treenode.GetBlockTree(tree.ID) != nil {
			t.Fatal("deleted document remains in block tree")
		}
	}
	var remaining int
	if err := db.QueryRow("SELECT COUNT(*) FROM blocks WHERE id LIKE 'seed-%'").Scan(&remaining); err != nil {
		t.Fatal(err)
	}
	if remaining != count {
		t.Fatalf("unrelated blocks changed: got %d, want %d", remaining, count)
	}
}
