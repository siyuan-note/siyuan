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
	"path/filepath"
	"strings"
	"testing"

	"github.com/88250/lute/parse"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestImportNotebookSYAsChildDocuments(t *testing.T) {
	const (
		sourceBoxID     = "20260903000100-box0001"
		targetBoxID     = "20260903000101-box0002"
		sourceFirstID   = "20260903000102-doc0001"
		sourceSecondID  = "20260903000103-doc0002"
		targetParentID  = "20260903000104-doc0003"
		existingChildID = "20260903000105-doc0004"
	)
	setupExportRelatedTest(t, sourceBoxID, targetBoxID)
	setupNotebookDocumentImportDatabase(t)
	*Conf.FileTree.CreateDocAtTop = false

	sourceBox := &Box{ID: sourceBoxID}
	sourceConf := sourceBox.GetConf()
	sourceConf.Name = "Source Notebook"
	if err := sourceBox.SaveConf(sourceConf); nil != err {
		t.Fatal(err)
	}
	targetBox := &Box{ID: targetBoxID}
	targetConf := targetBox.GetConf()
	targetConf.Name = "Target Notebook"
	if err := targetBox.SaveConf(targetConf); nil != err {
		t.Fatal(err)
	}

	sourceBoxTree := treenode.NewTree(sourceBoxID, boxDocPath(sourceBoxID), "/Source Notebook", "Source Notebook")
	sourceBoxTree.Root.SetIALAttr(DocHiddenAttr, "true")
	for _, tree := range []*parse.Tree{
		sourceBoxTree,
		treenode.NewTree(sourceBoxID, "/"+sourceFirstID+".sy", "/First", "First"),
		treenode.NewTree(sourceBoxID, "/"+sourceSecondID+".sy", "/Second", "Second"),
		treenode.NewTree(targetBoxID, "/"+targetParentID+".sy", "/Target", "Target"),
		treenode.NewTree(targetBoxID, "/"+targetParentID+"/"+existingChildID+".sy", "/Target/Existing", "Existing"),
	} {
		writeExportRelatedTestTree(t, tree)
	}
	if err := writeBoxDocID(sourceBoxID); nil != err {
		t.Fatal(err)
	}
	if err := writeSortConfMap(filepath.Join(util.DataDir, sourceBoxID, ".siyuan", "sort.json"), map[string]int{
		sourceFirstID:  20,
		sourceSecondID: 10,
	}); nil != err {
		t.Fatal(err)
	}
	if err := writeSortConfMap(filepath.Join(util.DataDir, targetBoxID, ".siyuan", "sort.json"), map[string]int{
		existingChildID: 0,
	}); nil != err {
		t.Fatal(err)
	}

	exportPath := ExportNotebookSY(sourceBoxID)
	exportAbsPath, err := exportedFilePath(exportPath)
	if nil != err {
		t.Fatal(err)
	}
	if err = ImportSY(exportAbsPath, targetBoxID, "/"+targetParentID+".sy"); nil != err {
		t.Fatal(err)
	}

	childrenDir := filepath.Join(util.DataDir, targetBoxID, targetParentID)
	entries, err := os.ReadDir(childrenDir)
	if nil != err {
		t.Fatal(err)
	}
	importedIDs := map[string]string{}
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".sy") {
			continue
		}
		id := strings.TrimSuffix(entry.Name(), ".sy")
		for _, oldID := range []string{sourceBoxID, sourceFirstID, sourceSecondID} {
			if strings.HasPrefix(id, oldID[:15]) {
				importedIDs[oldID] = id
			}
		}
	}
	if len(importedIDs) != 3 {
		t.Fatalf("imported document IDs = %v, want notebook document and two root documents", importedIDs)
	}

	importedBoxDocPath := "/" + targetParentID + "/" + importedIDs[sourceBoxID] + ".sy"
	importedBoxDoc, err := filesys.LoadTree(targetBoxID, importedBoxDocPath, util.NewLute())
	if nil != err {
		t.Fatal(err)
	}
	if hidden := importedBoxDoc.Root.IALAttr(DocHiddenAttr); hidden != "" {
		t.Fatalf("imported notebook document remains hidden: %q", hidden)
	}
	if got := (&Box{ID: targetBoxID}).GetConf().Name; got != "Target Notebook" {
		t.Fatalf("target notebook name = %q, want %q", got, "Target Notebook")
	}
	if filelock.IsExist(boxDocMetaPath(targetBoxID)) {
		t.Fatal("source notebook metadata was copied into the target notebook")
	}

	sortIDs, err := readSortConfMap(filepath.Join(util.DataDir, targetBoxID, ".siyuan", "sort.json"))
	if nil != err {
		t.Fatal(err)
	}
	if sortIDs[existingChildID] >= sortIDs[importedIDs[sourceSecondID]] ||
		sortIDs[importedIDs[sourceSecondID]] >= sortIDs[importedIDs[sourceFirstID]] {
		t.Fatalf("unexpected imported document order: %v", sortIDs)
	}
}

func setupNotebookDocumentImportDatabase(t *testing.T) {
	t.Helper()
	originalConfDir := util.ConfDir
	originalQueueDir := util.QueueDir
	originalDBPath := util.DBPath
	originalHistoryDBPath := util.HistoryDBPath
	originalAssetContentDBPath := util.AssetContentDBPath
	util.ConfDir = filepath.Join(util.TempDir, "conf")
	util.QueueDir = filepath.Join(util.TempDir, "queue")
	util.DBPath = filepath.Join(util.TempDir, util.DBName)
	util.HistoryDBPath = filepath.Join(util.TempDir, "history.db")
	util.AssetContentDBPath = filepath.Join(util.TempDir, "asset_content.db")
	for _, dir := range []string{util.ConfDir, util.QueueDir} {
		if err := os.MkdirAll(dir, 0755); nil != err {
			t.Fatal(err)
		}
	}
	sql.InitDatabase(true)
	sql.InitHistoryDatabase(true)
	sql.InitAssetContentDatabase(true)
	t.Cleanup(func() {
		sql.CloseDatabase()
		util.ConfDir = originalConfDir
		util.QueueDir = originalQueueDir
		util.DBPath = originalDBPath
		util.HistoryDBPath = originalHistoryDBPath
		util.AssetContentDBPath = originalAssetContentDBPath
	})
}
