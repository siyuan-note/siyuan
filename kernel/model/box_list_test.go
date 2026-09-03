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

	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestListNotebooksIgnoresBoxWithoutConfAndDocuments(t *testing.T) {
	oldConf, oldDataDir := Conf, util.DataDir
	util.DataDir = t.TempDir()
	Conf = NewAppConf()
	Conf.FileTree = conf.NewFileTree()
	Conf.NotebookCrypto = conf.NewNotebookCrypto()
	Conf.Sync = conf.NewSync()
	Conf.Sync.Enabled = true
	t.Cleanup(func() {
		Conf, util.DataDir = oldConf, oldDataDir
	})

	boxID := "20260903120000-abcdefg"
	boxDirPath := filepath.Join(util.DataDir, boxID)
	emptyDocDirPath := filepath.Join(boxDirPath, "20260903120100-hijklmn")
	if err := os.MkdirAll(emptyDocDirPath, 0755); err != nil {
		t.Fatal(err)
	}
	hiddenFilePath := filepath.Join(boxDirPath, ".DS_Store")
	if err := os.WriteFile(hiddenFilePath, nil, 0644); err != nil {
		t.Fatal(err)
	}

	boxes, err := ListNotebooks()
	if err != nil {
		t.Fatal(err)
	}
	if 0 != len(boxes) {
		t.Fatalf("expected orphan box directory to be ignored, got %+v", boxes)
	}
	confPath := filepath.Join(boxDirPath, ".siyuan", "conf.json")
	if _, err = os.Stat(confPath); !os.IsNotExist(err) {
		t.Fatalf("expected notebook conf not to be recreated: %v", err)
	}
	if _, err = os.Stat(hiddenFilePath); err != nil {
		t.Fatalf("expected ignored local file to be preserved: %v", err)
	}
	if _, err = os.Stat(emptyDocDirPath); err != nil {
		t.Fatalf("expected residual directory to be preserved: %v", err)
	}
}

func TestListNotebooksDoesNotRepairBoxWithDocuments(t *testing.T) {
	oldConf, oldDataDir := Conf, util.DataDir
	util.DataDir = t.TempDir()
	Conf = NewAppConf()
	Conf.FileTree = conf.NewFileTree()
	Conf.NotebookCrypto = conf.NewNotebookCrypto()
	Conf.Sync = conf.NewSync()
	Conf.Sync.Enabled = true
	t.Cleanup(func() {
		Conf, util.DataDir = oldConf, oldDataDir
	})

	boxID := "20260903120500-jklmnop"
	docPath := filepath.Join(util.DataDir, boxID, "20260903120600-qrstuvw.sy")
	if err := os.MkdirAll(filepath.Dir(docPath), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(docPath, []byte("{}"), 0644); err != nil {
		t.Fatal(err)
	}

	boxes, err := ListNotebooks()
	if err != nil {
		t.Fatal(err)
	}
	if 0 != len(boxes) {
		t.Fatalf("expected box repair to require an explicit lifecycle step, got %+v", boxes)
	}
	confPath := filepath.Join(util.DataDir, boxID, ".siyuan", "conf.json")
	if _, err = os.Stat(confPath); !os.IsNotExist(err) {
		t.Fatalf("expected notebook conf not to be recreated while listing: %v", err)
	}
}

func TestHasLiveBoxDocuments(t *testing.T) {
	boxDirPath := t.TempDir()
	historyDocPath := filepath.Join(boxDirPath, ".siyuan", "history", "20260903120200-opqrstu.sy")
	if err := os.MkdirAll(filepath.Dir(historyDocPath), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(historyDocPath, nil, 0644); err != nil {
		t.Fatal(err)
	}

	hasDocuments, err := hasLiveBoxDocuments(boxDirPath)
	if err != nil {
		t.Fatal(err)
	}
	if hasDocuments {
		t.Fatal("expected notebook history not to be treated as a live document")
	}

	liveDocPath := filepath.Join(boxDirPath, "20260903120300-vwxyzab", "20260903120400-cdefghi.sy")
	if err = os.MkdirAll(filepath.Dir(liveDocPath), 0755); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(liveDocPath, nil, 0644); err != nil {
		t.Fatal(err)
	}

	hasDocuments, err = hasLiveBoxDocuments(boxDirPath)
	if err != nil {
		t.Fatal(err)
	}
	if !hasDocuments {
		t.Fatal("expected live notebook document to be detected")
	}
}
