//go:build fts5

package model

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestMoveDocsBatchCustomOrder(t *testing.T) {
	for _, crossBox := range []bool{false, true} {
		for _, atTop := range []bool{false, true} {
			t.Run(filepath.Join(map[bool]string{false: "same", true: "cross"}[crossBox], map[bool]string{false: "bottom", true: "top"}[atTop]), func(t *testing.T) {
				if os.Getenv("SIYUAN_TEST_MOVE_SORT") != t.Name() {
					cmd := exec.Command(os.Args[0], "-test.run=^TestMoveDocsBatchCustomOrder$", "-test.v")
					cmd.Env = append(os.Environ(), "SIYUAN_TEST_MOVE_SORT="+t.Name())
					if os.Getenv("SIYUAN_TEST_MOVE_SORT") != "" {
						return
					}
					if output, err := cmd.CombinedOutput(); err != nil {
						t.Fatalf("move sort subprocess failed: %v\n%s", err, output)
					}
					return
				}
				f := setupFileOperationTest(t)
				util.TempDir = t.TempDir()
				util.QueueDir = filepath.Join(util.TempDir, "queue")
				util.ConfDir = filepath.Join(util.TempDir, "conf")
				util.DBPath = filepath.Join(util.TempDir, util.DBName)
				util.HistoryDBPath = filepath.Join(util.TempDir, "history.db")
				util.AssetContentDBPath = filepath.Join(util.TempDir, "asset_content.db")
				if err := os.MkdirAll(util.ConfDir, 0755); err != nil {
					t.Fatal(err)
				}
				sql.InitDatabase(true)
				sql.InitHistoryDatabase(true)
				sql.InitAssetContentDatabase(true)
				t.Cleanup(sql.CloseDatabase)
				for _, p := range []string{f.sourcePath, f.targetPath} {
					tree, err := filesys.LoadTree(f.box.ID, p, util.NewLute())
					if err != nil {
						t.Fatal(err)
					}
					treenode.UpsertBlockTree(tree)
				}
				Conf.FileTree.CreateDocAtTop = &atTop
				a := addFileOperationTestDoc(t, f, "20260718000003-abcdefg", "A", false)
				b := addFileOperationTestDoc(t, f, "20260718000004-abcdefg", "B", false)
				if err := MoveDocs([]string{a.Path, b.Path}, f.box.ID, f.sourcePath, nil); err != nil {
					t.Fatal(err)
				}
				targetBox := f.box
				if crossBox {
					targetBox = &Box{ID: "20260718000010-abcdefg"}
					boxConf := conf.NewBoxConf()
					boxConf.Closed = false
					if err := targetBox.SaveConf(boxConf); err != nil {
						t.Fatal(err)
					}
					if err := MoveDocs([]string{f.targetPath}, targetBox.ID, "/", nil); err != nil {
						t.Fatal(err)
					}
				}
				// 源列表使用旧版零起点编号，目标列表中包含相同编号。
				if err := writeSortConfMap(filepath.Join(util.DataDir, f.box.ID, ".siyuan", "sort.json"), map[string]int{a.ID: 0, b.ID: 1, f.sourceID: 1, f.targetID: 1}); err != nil {
					t.Fatal(err)
				}
				paths := []string{"/" + f.sourceID + "/" + b.ID + ".sy", "/" + f.sourceID + "/" + a.ID + ".sy"}
				if err := MoveDocs(paths, targetBox.ID, "/", nil); err != nil {
					t.Fatal(err)
				}
				existing := []string{f.targetID, f.sourceID}
				if crossBox {
					existing = []string{f.targetID}
				}
				want := append(existing, b.ID, a.ID)
				if atTop {
					want = append([]string{b.ID, a.ID}, existing...)
				}
				assertSiblingCustomOrder(t, targetBox.ID, "/", want)
				// 同时覆盖移动到已有子文档的父文档下，以及明确的前后落点。
				if err := MoveDocs([]string{"/" + a.ID + ".sy"}, targetBox.ID, f.targetPath, nil); err != nil {
					t.Fatal(err)
				}
				if err := MoveDocs([]string{"/" + b.ID + ".sy"}, targetBox.ID, f.targetPath, nil); err != nil {
					t.Fatal(err)
				}
				childOrder := []string{a.ID, b.ID}
				if atTop {
					childOrder = []string{b.ID, a.ID}
				}
				assertSiblingCustomOrder(t, targetBox.ID, "/"+f.targetID, childOrder)
				position := "before"
				if atTop {
					position = "after"
				}
				Conf.FileTree.Sort = util.SortModeCustom
				if _, err := ReorderDocTree([]string{b.ID, a.ID}, f.targetID, position, false, true); err != nil {
					t.Fatal(err)
				}
				want = []string{b.ID, a.ID, f.targetID}
				if atTop {
					want = []string{f.targetID, b.ID, a.ID}
				}
				if !crossBox {
					want = append(want, f.sourceID)
				}
				assertSiblingCustomOrder(t, targetBox.ID, "/", want)
			})
		}
	}
}
