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

package model

import (
	"os"
	"path/filepath"
	"testing"

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
