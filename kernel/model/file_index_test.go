// SiYuan - Refactor your thinking
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

//go:build fts5

package model

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

const removeDocSQLTestEnv = "SIYUAN_TEST_REMOVE_DOC_SQL"

func TestRemoveDocFlushesDatabaseIndex(t *testing.T) {
	if "1" != os.Getenv(removeDocSQLTestEnv) {
		cmd := exec.Command(os.Args[0], "-test.run=^TestRemoveDocFlushesDatabaseIndex$", "-test.v")
		cmd.Env = append(os.Environ(), removeDocSQLTestEnv+"=1")
		output, err := cmd.CombinedOutput()
		if nil != err {
			t.Fatalf("remove document SQL subprocess failed: %v\n%s", err, output)
		}
		return
	}

	workspaceDir := t.TempDir()
	util.WorkspaceDir = workspaceDir
	util.ConfDir = filepath.Join(workspaceDir, "conf")
	util.DataDir = filepath.Join(workspaceDir, "data")
	util.HistoryDir = filepath.Join(workspaceDir, "history")
	util.TempDir = filepath.Join(workspaceDir, "temp")
	util.QueueDir = filepath.Join(util.TempDir, "queue")
	util.DBPath = filepath.Join(util.TempDir, util.DBName)
	util.HistoryDBPath = filepath.Join(util.TempDir, "history.db")
	util.AssetContentDBPath = filepath.Join(util.TempDir, "asset_content.db")
	util.BlockTreeDBPath = filepath.Join(util.TempDir, "blocktree.db")
	for _, dir := range []string{util.ConfDir, util.DataDir, util.HistoryDir, util.TempDir, util.QueueDir} {
		if err := os.MkdirAll(dir, 0755); err != nil {
			t.Fatalf("create test directory [%s] failed: %v", dir, err)
		}
	}

	Conf = NewAppConf()
	Conf.FileTree = conf.NewFileTree()
	Conf.NotebookCrypto = conf.NewNotebookCrypto()
	Conf.Sync = conf.NewSync()

	box := &Box{ID: "20260726000000-abcdefg"}
	boxConf := conf.NewBoxConf()
	boxConf.Name = "Remove document SQL test"
	boxConf.Closed = false
	if err := box.SaveConf(boxConf); err != nil {
		t.Fatalf("save test notebook conf failed: %v", err)
	}

	sql.InitDatabase(true)
	sql.InitHistoryDatabase(true)
	sql.InitAssetContentDatabase(true)
	t.Cleanup(sql.CloseDatabase)

	tree := treenode.NewTree(box.ID, "/20260726000001-abcdefg.sy", "/Delete target", "Delete target")
	if err := indexWriteTreeIndexQueue(tree); err != nil {
		t.Fatalf("write and index test document failed: %v", err)
	}
	sql.FlushQueue()
	assertDatabaseBlockExists(t, tree.ID, true)

	if err := RemoveDoc(box.ID, tree.Path); err != nil {
		t.Fatalf("remove test document failed: %v", err)
	}
	sql.FlushQueue()
	assertDatabaseBlockExists(t, tree.ID, false)
}

func assertDatabaseBlockExists(t *testing.T, id string, expected bool) {
	t.Helper()

	rows, err := sql.Query("SELECT id FROM blocks WHERE id = '"+id+"'", 1)
	if nil != err {
		t.Fatalf("query block [%s] failed: %v", id, err)
	}
	if actual := 0 < len(rows); actual != expected {
		t.Fatalf("unexpected database block existence for [%s]: got %t, want %t", id, actual, expected)
	}
}
