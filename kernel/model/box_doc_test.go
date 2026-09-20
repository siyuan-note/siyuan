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
	"os"
	"path/filepath"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestBoxDocMetadataMatchesBoxID(t *testing.T) {
	originalDataDir := util.DataDir
	util.DataDir = t.TempDir()
	t.Cleanup(func() {
		util.DataDir = originalDataDir
	})

	boxID := "20260716120000-abcdefg"
	if err := os.MkdirAll(filepath.Dir(boxDocMetaPath(boxID)), 0755); err != nil {
		t.Fatal(err)
	}
	if err := writeBoxDocID(boxID); err != nil {
		t.Fatal(err)
	}
	if boxDocID, err := readBoxDocID(boxID); err != nil || boxDocID != boxID {
		t.Fatalf("unexpected box document metadata [id=%s, err=%v]", boxDocID, err)
	}

	data := []byte(`{"spec":1,"boxDocID":"20260716120001-abcdefg"}`)
	if err := os.WriteFile(boxDocMetaPath(boxID), data, 0644); err != nil {
		t.Fatal(err)
	}
	if _, err := readBoxDocID(boxID); err == nil {
		t.Fatal("mismatched box document ID was accepted")
	}
}

func TestFindBoxDocRejectsOrdinaryDocument(t *testing.T) {
	originalDataDir := util.DataDir
	util.DataDir = t.TempDir()
	t.Cleanup(func() {
		util.DataDir = originalDataDir
	})

	boxID := "20260716120010-abcdefg"
	if err := os.MkdirAll(filepath.Join(util.DataDir, boxID), 0755); err != nil {
		t.Fatal(err)
	}
	tree := treenode.NewTree(boxID, boxDocPath(boxID), "/Existing", "Existing")
	if _, err := filesys.WriteTree(tree); err != nil {
		t.Fatal(err)
	}
	box := &Box{ID: boxID}
	if _, err := findBoxDoc(box); err == nil {
		t.Fatal("ordinary document was accepted as the box document")
	}

	tree.Root.SetIALAttr(DocHiddenAttr, "true")
	if _, err := filesys.WriteTree(tree); err != nil {
		t.Fatal(err)
	}
	if boxDocID, err := findBoxDoc(box); err != nil || boxDocID != boxID {
		t.Fatalf("unexpected recovered box document [id=%s, err=%v]", boxDocID, err)
	}
}

func TestFindUnindexedTreePathIgnoresTextMatch(t *testing.T) {
	originalConf := Conf
	originalDataDir := util.DataDir
	originalBlockTreeDBPath := util.BlockTreeDBPath
	tempDir := t.TempDir()
	util.DataDir = filepath.Join(tempDir, "data")
	util.BlockTreeDBPath = filepath.Join(tempDir, "blocktree.db")
	Conf = NewAppConf()
	Conf.FileTree = conf.NewFileTree()
	Conf.NotebookCrypto = conf.NewNotebookCrypto()
	Conf.Sync = conf.NewSync()

	box := &Box{ID: "20260716120010-abcdefg"}
	boxConf := conf.NewBoxConf()
	boxConf.Name = "Unindexed tree test"
	if err := box.SaveConf(boxConf); nil != err {
		t.Fatal(err)
	}
	treenode.InitBlockTree(true)
	docID := "20260716120011-abcdefg"
	targetID := "20210808180117-6v0mkxr"
	tree := treenode.NewTree(box.ID, "/"+docID+".sy", "/Test", "Test")
	paragraph := &ast.Node{Type: ast.NodeParagraph, ID: "20260716120012-abcdefg"}
	paragraph.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte(targetID)})
	tree.Root.AppendChild(paragraph)
	if _, err := filesys.WriteTree(tree); nil != err {
		t.Fatal(err)
	}

	t.Cleanup(func() {
		cache.RemoveTreeDataInBox(docID, box.ID)
		treenode.CloseDatabase()
		Conf = originalConf
		util.DataDir = originalDataDir
		util.BlockTreeDBPath = originalBlockTreeDBPath
		if "" != originalBlockTreeDBPath {
			treenode.InitBlockTree(false)
		}
	})

	if matchedPath := findUnindexedTreePathInAllBoxes(targetID); "" != matchedPath {
		t.Fatalf("text content was recognized as a block ID [path=%s]", matchedPath)
	}
	sortPath := filepath.Join(util.DataDir, box.ID, ".siyuan", "sort.json")
	sortData := []byte(`{"` + targetID + `":1}`)
	if err := os.WriteFile(sortPath, sortData, 0600); err != nil {
		t.Fatal(err)
	}
	if matchedPath := findUnindexedTreePathInAllBoxes(targetID); matchedPath != "" {
		t.Fatalf("sort configuration was recognized as a document [path=%s]", matchedPath)
	}
	if got, err := os.ReadFile(sortPath); err != nil || string(got) != string(sortData) {
		t.Fatalf("sort configuration changed during reindex fallback: %v", err)
	}
	paragraph.ID = targetID
	if _, err := filesys.WriteTree(tree); nil != err {
		t.Fatal(err)
	}
	if matchedPath := findUnindexedTreePathInAllBoxes(targetID); "" == matchedPath {
		t.Fatal("actual block ID was not found")
	}
}

func TestBoxDocSubFileCount(t *testing.T) {
	originalDataDir := util.DataDir
	util.DataDir = t.TempDir()
	t.Cleanup(func() {
		util.DataDir = originalDataDir
	})

	boxID := "20260716120000-abcdefg"
	boxDocID := boxID
	boxDir := filepath.Join(util.DataDir, boxID)
	if err := os.MkdirAll(boxDir, 0755); err != nil {
		t.Fatal(err)
	}
	writeDoc := func(id, properties string) {
		t.Helper()
		data := []byte(`{"Properties":` + properties + `}`)
		if err := os.WriteFile(filepath.Join(boxDir, id+".sy"), data, 0644); err != nil {
			t.Fatal(err)
		}
	}
	writeDoc(boxDocID, `{}`)
	writeDoc("20260716120002-abcdefg", `{}`)
	writeDoc("20260716120003-abcdefg", `{"custom-hidden":"true"}`)
	writeDoc("invalid", `{}`)
	if err := os.Mkdir(filepath.Join(boxDir, "20260716120004-abcdefg.sy"), 0755); err != nil {
		t.Fatal(err)
	}

	if actual := BoxDocSubFileCount(boxID); actual != 1 {
		t.Fatalf("unexpected box document subfile count [%d]", actual)
	}
	publishAccess := PublishAccess{{ID: "20260716120002-abcdefg", Visible: false}}
	if actual := BoxDocSubFileCountForPublish(boxID, publishAccess); actual != 0 {
		t.Fatalf("unexpected published box document subfile count [%d]", actual)
	}
	publishAccess[0].Visible = true
	if actual := BoxDocSubFileCountForPublish(boxID, publishAccess); actual != 1 {
		t.Fatalf("unexpected visible published box document subfile count [%d]", actual)
	}
}

// TestBoxDocSubFileCountForPublishAt 验证发布访问控制下指定文档的可见直接子文档数。
func TestBoxDocSubFileCountForPublishAt(t *testing.T) {
	originalDataDir := util.DataDir
	util.DataDir = t.TempDir()
	t.Cleanup(func() {
		util.DataDir = originalDataDir
	})

	const (
		boxID       = "20260716130000-abcdefg"
		parentID    = "20260716130001-abcdefg"
		publicID    = "20260716130002-abcdefg"
		hiddenID    = "20260716130003-abcdefg"
		forbiddenID = "20260716130004-abcdefg"
	)
	boxDir := filepath.Join(util.DataDir, boxID)
	if err := os.MkdirAll(filepath.Join(boxDir, parentID), 0755); err != nil {
		t.Fatal(err)
	}
	writeDoc := func(dir, id string) {
		t.Helper()
		if err := os.WriteFile(filepath.Join(boxDir, dir, id+".sy"), []byte(`{"Properties":{}}`), 0644); err != nil {
			t.Fatal(err)
		}
	}
	writeDoc(".", parentID)
	writeDoc(parentID, publicID)
	writeDoc(parentID, hiddenID)
	writeDoc(parentID, forbiddenID)

	parentPath := "/" + parentID + ".sy"
	if actual := BoxDocSubFileCountForPublishAt(boxID, parentPath, PublishAccess{}); actual != 3 {
		t.Fatalf("unexpected subfile count [%d]", actual)
	}

	publishAccess := PublishAccess{
		{ID: hiddenID, Visible: false},
		{ID: forbiddenID, Visible: false, Disable: true},
	}
	if actual := BoxDocSubFileCountForPublishAt(boxID, parentPath, publishAccess); actual != 1 {
		t.Fatalf("unexpected published subfile count [%d]", actual)
	}
}
