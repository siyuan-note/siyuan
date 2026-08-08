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

package model

import (
	"archive/zip"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestExportSYIncludesRelatedDocsAcrossNormalBoxes(t *testing.T) {
	const (
		sourceBoxID   = "20260808120000-box0001"
		targetBoxID   = "20260808120001-box0002"
		sourceDocID   = "20260808120002-doc0001"
		targetDocID   = "20260808120003-doc0002"
		sourceBlockID = "20260808120004-block01"
		targetBlockID = "20260808120005-block02"
	)

	setupExportRelatedTest(t, sourceBoxID, targetBoxID)
	sourceTree := treenode.NewTree(sourceBoxID, "/"+sourceDocID+".sy", "/Source", "Source")
	sourceBlock := treenode.NewParagraph(sourceBlockID)
	sourceBlock.AppendChild(&ast.Node{
		Type:                    ast.NodeTextMark,
		TextMarkType:            "block-ref",
		TextMarkBlockRefID:      targetBlockID,
		TextMarkBlockRefSubtype: "d",
		TextMarkTextContent:     "Target",
	})
	sourceTree.Root.AppendChild(sourceBlock)
	targetTree := treenode.NewTree(targetBoxID, "/"+targetDocID+".sy", "/Target", "Target")
	targetTree.Root.AppendChild(treenode.NewParagraph(targetBlockID))
	writeExportRelatedTestTree(t, sourceTree)
	writeExportRelatedTestTree(t, targetTree)

	zipURI := ExportSYs([]string{sourceDocID})
	if "" == zipURI {
		t.Fatal("export returned an empty archive path")
	}
	zipPath := filepath.Join(util.TempDir, filepath.FromSlash(strings.TrimPrefix(zipURI, "/")))
	archive, err := zip.OpenReader(zipPath)
	if err != nil {
		t.Fatalf("open exported archive failed: %s", err)
	}
	defer archive.Close()

	relatedPath := filepath.ToSlash(filepath.Join("Source", targetDocID+".sy"))
	for _, file := range archive.File {
		if file.Name == relatedPath {
			return
		}
	}
	t.Fatalf("related document [%s] was not included in exported archive", relatedPath)
}

func TestLoadExportRelatedTreeRejectsCrossCryptoBoundary(t *testing.T) {
	const (
		sourceBoxID = "20260808120100-box0001"
		targetBoxID = "20260808120101-box0002"
		targetDocID = "20260808120102-doc0001"
	)

	setupExportRelatedTest(t, sourceBoxID, targetBoxID)
	targetTree := treenode.NewTree(targetBoxID, "/"+targetDocID+".sy", "/Target", "Target")
	writeExportRelatedTestTree(t, targetTree)
	markRuntimeEncryptedBox(targetBoxID)
	t.Cleanup(func() {
		forgetRuntimeEncryptedBox(targetBoxID)
	})

	if _, err := loadExportRelatedTree(targetDocID, sourceBoxID); !errors.Is(err, ErrTreeNotFound) {
		t.Fatalf("cross-boundary related tree should be rejected, got %v", err)
	}
}

func setupExportRelatedTest(t *testing.T, boxIDs ...string) {
	t.Helper()
	originalConf := Conf
	originalDataDir := util.DataDir
	originalTempDir := util.TempDir
	originalBlockTreeDBPath := util.BlockTreeDBPath
	testRoot := t.TempDir()
	util.DataDir = filepath.Join(testRoot, "data")
	util.TempDir = filepath.Join(testRoot, "temp")
	util.BlockTreeDBPath = filepath.Join(testRoot, "blocktree.db")
	Conf = NewAppConf()
	Conf.Export = conf.NewExport()
	Conf.Export.IncludeSubDocs = false
	Conf.Export.IncludeRelatedDocs = true
	Conf.FileTree = conf.NewFileTree()
	Conf.Flashcard = conf.NewFlashcard()
	Conf.NotebookCrypto = conf.NewNotebookCrypto()
	Conf.Sync = conf.NewSync()
	if err := os.MkdirAll(util.DataDir, 0755); err != nil {
		t.Fatal(err)
	}
	for _, boxID := range boxIDs {
		boxConf := conf.NewBoxConf()
		boxConf.Name = boxID
		boxConf.Closed = false
		if err := (&Box{ID: boxID}).SaveConf(boxConf); err != nil {
			t.Fatal(err)
		}
		markRuntimeNormalBox(boxID)
	}
	treenode.InitBlockTree(true)
	t.Cleanup(func() {
		for _, boxID := range boxIDs {
			forgetRuntimeEncryptedBox(boxID)
			forgetRuntimeNormalBox(boxID)
		}
		treenode.CloseDatabase()
		Conf = originalConf
		util.DataDir = originalDataDir
		util.TempDir = originalTempDir
		util.BlockTreeDBPath = originalBlockTreeDBPath
		if "" != originalBlockTreeDBPath {
			treenode.InitBlockTree(false)
		}
	})
}

func writeExportRelatedTestTree(t *testing.T, tree *parse.Tree) {
	t.Helper()
	treenode.UpsertBlockTree(tree)
	if _, err := filesys.WriteTree(tree); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		cache.RemoveTreeDataInBox(tree.ID, tree.Box)
	})
}
