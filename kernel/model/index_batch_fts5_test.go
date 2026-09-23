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
	"github.com/siyuan-note/eventbus"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestIndexBoxBatches(t *testing.T) {
	if os.Getenv("SIYUAN_TEST_INDEX_BATCHES") != "1" {
		ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
		defer cancel()
		cmd := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestIndexBoxBatches$", "-test.timeout=60s", "-test.v")
		cmd.Env = append(os.Environ(), "SIYUAN_TEST_INDEX_BATCHES=1")
		if output, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("index batch subprocess: %v\n%s", err, output)
		}
		return
	}
	prepareHPathRefreshTest(t)
	database, err := gosql.Open("sqlite3_extended", util.DBPath)
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	var flushed []int
	var currentBox string
	eventbus.Subscribe(eventbus.EvtSQLIndexFlushed, func() {
		var documents int
		if err := database.QueryRow("SELECT COUNT(*) FROM blocks WHERE box = ? AND type = 'd'", currentBox).Scan(&documents); err != nil {
			t.Error(err)
		}
		flushed = append(flushed, documents)
	})
	for _, tc := range []struct {
		name      string
		documents int
		padding   int
	}{
		{"many documents", 65, 0},
		{"large source files", 3, 4*1024*1024 + 1024},
	} {
		t.Run(tc.name, func(t *testing.T) {
			box := &Box{ID: ast.NewNodeID()}
			boxConf := conf.NewBoxConf()
			boxConf.Name, boxConf.Closed = "Batch", false
			if err := box.SaveConf(boxConf); err != nil {
				t.Fatal(err)
			}
			avID := ast.NewNodeID()
			if err := av.SaveAttributeView(av.NewAttributeView(avID)); err != nil {
				t.Fatal(err)
			}
			for range tc.documents {
				id := ast.NewNodeID()
				tree := treenode.NewTree(box.ID, "/"+id+".sy", "/Batch", "Batch")
				tree.Root.AppendChild(&ast.Node{Type: ast.NodeAttributeView, ID: ast.NewNodeID(), AttributeViewID: avID})
				if _, err := filesys.WriteTree(tree); err != nil {
					t.Fatal(err)
				}
				if tc.padding > 0 {
					file, err := os.OpenFile(filepath.Join(util.DataDir, box.ID, tree.Path), os.O_APPEND|os.O_WRONLY, 0644)
					if err != nil {
						t.Fatal(err)
					}
					_, err = file.Write(bytes.Repeat([]byte(" "), tc.padding))
					file.Close()
					if err != nil {
						t.Fatal(err)
					}
				}
			}
			for range 2 {
				flushed, currentBox = nil, box.ID
				indexBox(box.ID)
				if len(flushed) < 3 || flushed[0] >= tc.documents || flushed[len(flushed)-1] != tc.documents {
					t.Fatalf("documents were not committed in bounded batches: %v", flushed)
				}
				var rows, unique int
				if err := database.QueryRow("SELECT COUNT(*), COUNT(DISTINCT id) FROM blocks WHERE box = ?", box.ID).Scan(&rows, &unique); err != nil {
					t.Fatal(err)
				}
				if rows != unique || rows != tc.documents*3 {
					t.Fatalf("rebuilding lost or duplicated blocks: %d rows, %d unique", rows, unique)
				}
				if mirrors := av.GetBlockRels()[avID]; len(mirrors) != tc.documents {
					t.Fatalf("rebuilding lost or duplicated database mirrors: %d", len(mirrors))
				}
				sql.FlushQueue()
			}
		})
	}
}
