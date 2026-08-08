// SiYuan - From thought to insight, with agents
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
	"path"
	"path/filepath"
	"testing"
	"time"

	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

const removeDocSQLTestEnv = "SIYUAN_TEST_REMOVE_DOC_SQL"
const docTemplateSQLTestEnv = "SIYUAN_TEST_DOC_TEMPLATE_SQL"

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
	childTree := treenode.NewTree(
		box.ID,
		path.Join("/20260726000001-abcdefg", "20260726000002-abcdefg.sy"),
		"/Delete target/Child",
		"Child",
	)
	if err := indexWriteTreeIndexQueue(childTree); err != nil {
		t.Fatalf("write and index child test document failed: %v", err)
	}
	sql.FlushQueue()
	assertDatabaseBlockExists(t, tree.ID, true)
	assertDatabaseBlockExists(t, childTree.ID, true)

	blockIDs := []string{tree.ID, tree.Root.FirstChild.ID, childTree.ID, childTree.Root.FirstChild.ID}
	for _, blockID := range blockIDs {
		warmBlockIALCache(t, blockID, box.ID)
	}
	if _, ok := cache.GetTreeDataInBox(childTree.ID, box.ID); !ok {
		t.Fatalf("child tree data cache [%s] was not populated", childTree.ID)
	}
	if ial := cache.GetDocIALInBox(childTree.Path, box.ID); nil == ial {
		t.Fatalf("child document IAL cache [%s] was not populated", childTree.Path)
	}

	if err := RemoveDoc(box.ID, tree.Path); err != nil {
		t.Fatalf("remove test document failed: %v", err)
	}

	for _, blockID := range blockIDs {
		if ial := cache.GetBlockIALInBox(blockID, box.ID); nil != ial {
			t.Fatalf("deleted block IAL cache [%s] was retained: %+v", blockID, ial)
		}
		if ial := sql.GetBlockAttrs(blockID); 0 < len(ial) {
			t.Fatalf("deleted block attributes [%s] were retained: %+v", blockID, ial)
		}
	}
	if attrs := sql.BatchGetBlockAttrs(blockIDs); 0 < len(attrs) {
		t.Fatalf("deleted block attributes were retained in batch result: %+v", attrs)
	}
	for _, removedTree := range []*parse.Tree{tree, childTree} {
		if _, ok := cache.GetTreeDataInBox(removedTree.ID, box.ID); ok {
			t.Fatalf("deleted tree data cache [%s] was retained", removedTree.ID)
		}
		if ial := cache.GetDocIALInBox(removedTree.Path, box.ID); nil != ial {
			t.Fatalf("deleted document IAL cache [%s] was retained: %+v", removedTree.Path, ial)
		}
		if _, err := filesys.LoadTree(box.ID, removedTree.Path, util.NewLute()); nil == err {
			t.Fatalf("deleted tree [%s] was loaded from cache", removedTree.ID)
		}
	}

	sql.FlushQueue()
	assertDatabaseBlockExists(t, tree.ID, false)
	assertDatabaseBlockExists(t, childTree.ID, false)
}

func warmBlockIALCache(t *testing.T, blockID, boxID string) {
	t.Helper()

	deadline := time.Now().Add(time.Second)
	for {
		if attrs := sql.GetBlockAttrs(blockID); 0 == len(attrs) {
			t.Fatalf("block attributes [%s] were not found", blockID)
		}
		if nil != cache.GetBlockIALInBox(blockID, boxID) {
			return
		}
		if deadline.Before(time.Now()) {
			t.Fatalf("block IAL cache [%s] was not populated", blockID)
		}
		time.Sleep(time.Millisecond)
	}
}

func TestDocumentTemplatesWaitForDatabaseIndex(t *testing.T) {
	if "1" != os.Getenv(docTemplateSQLTestEnv) {
		cmd := exec.Command(os.Args[0], "-test.run=^TestDocumentTemplatesWaitForDatabaseIndex$", "-test.v")
		cmd.Env = append(os.Environ(), docTemplateSQLTestEnv+"=1")
		output, err := cmd.CombinedOutput()
		if nil != err {
			t.Fatalf("document template SQL subprocess failed: %v\n%s", err, output)
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
	Conf.Editor = conf.NewEditor()
	Conf.Export = conf.NewExport()
	Conf.NotebookCrypto = conf.NewNotebookCrypto()
	Conf.Sync = conf.NewSync()
	Conf.Lang = "en"
	util.WorkingDir = filepath.Clean(filepath.Join("..", "..", "app"))
	initLang()

	box := &Box{ID: "20260728000000-abcdefg"}
	boxConf := conf.NewBoxConf()
	boxConf.Name = "Document template SQL test"
	boxConf.Closed = false
	boxConf.DailyNoteSavePath = "/Daily note"
	boxConf.DailyNoteTemplatePath = "/indexed.md"
	if err := box.SaveConf(boxConf); err != nil {
		t.Fatalf("save test notebook conf failed: %v", err)
	}
	templateDir := filepath.Join(util.DataDir, "templates")
	if err := os.MkdirAll(templateDir, 0755); err != nil {
		t.Fatalf("create templates directory failed: %v", err)
	}
	template := `.action{range queryBlocks "SELECT * FROM blocks WHERE id = '?' LIMIT 1" .id}.action{.ID}.action{end}`
	if err := os.WriteFile(filepath.Join(templateDir, "indexed.md"), []byte(template), 0644); err != nil {
		t.Fatalf("write test template failed: %v", err)
	}

	sql.InitDatabase(true)
	sql.InitHistoryDatabase(true)
	sql.InitAssetContentDatabase(true)
	t.Cleanup(sql.CloseDatabase)

	dailyPath, existed, err := CreateDailyNote(box.ID)
	if nil != err {
		t.Fatalf("create daily note failed: %v", err)
	}
	if existed {
		t.Fatal("the first daily note creation should not reuse an existing document")
	}
	dailyID := util.GetTreeID(dailyPath)
	assertTemplateOutputIndexed(t, dailyID)

	docID := "20260728000001-abcdefg"
	arg := map[string]any{"docCreateTemplatePath": "/indexed.md"}
	createdID, err := CreateWithMarkdown("", box.ID, "/Default template", "", "", docID, false, "", arg)
	if nil != err {
		t.Fatalf("create document with default template failed: %v", err)
	}
	if docID != createdID {
		t.Fatalf("unexpected created document ID: got %s, want %s", createdID, docID)
	}
	assertTemplateOutputIndexed(t, docID)

	attributeViewDocID := "20260728000002-abcdefg"
	createdID, err = CreateWithMarkdown("", box.ID, "/Attribute view template", "", "", attributeViewDocID, false, "", nil)
	if nil != err {
		t.Fatalf("create attribute view item document failed: %v", err)
	}
	if err = applyNewItemContentTemplate("/indexed.md", createdID); nil != err {
		t.Fatalf("apply attribute view item content template failed: %v", err)
	}
	assertTemplateOutputIndexed(t, attributeViewDocID)
}

func assertTemplateOutputIndexed(t *testing.T, docID string) {
	t.Helper()

	blocks := sql.SelectBlocksRawStmt("SELECT * FROM blocks WHERE root_id = '"+docID+"' AND type = 'p'", 1, 32)
	for _, block := range blocks {
		if docID == block.Content {
			return
		}
	}
	t.Fatalf("template did not query and persist the indexed document [%s]", docID)
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
