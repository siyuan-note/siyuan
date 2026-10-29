// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestIndexFixPreservesNewerDocumentEdit(t *testing.T) {
	fixture := setupFileOperationTest(t)
	previousHistory := util.HistoryDir
	util.HistoryDir = t.TempDir()
	t.Cleanup(func() { util.HistoryDir = previousHistory })
	target, err := LoadTreeByBlockID(fixture.targetID)
	if err != nil {
		t.Fatal(err)
	}
	target.Root.FirstChild.ID = fixture.childID
	target.Root.FirstChild.SetIALAttr("id", fixture.childID)
	if _, err = filesys.WriteTree(target); err != nil {
		t.Fatal(err)
	}
	var latest []byte
	err = resetDuplicateBlocksOnFileSysBeforeWrite(func(tree *parse.Tree) {
		if tree.ID != target.ID {
			t.Fatal("unexpected repair target")
		}
		target.Root.SetIALAttr("title", "New user edit")
		if _, err := filesys.WriteTree(target); err != nil {
			t.Fatal(err)
		}
		latest, err = os.ReadFile(filepath.Join(util.DataDir, target.Box, target.Path))
		if err != nil {
			t.Fatal(err)
		}
	})
	if !errors.Is(err, util.ErrFileChanged) || len(latest) == 0 {
		t.Fatalf("stale repair did not stop: %v", err)
	}
	retained, err := os.ReadFile(filepath.Join(util.DataDir, target.Box, target.Path))
	if err != nil || !bytes.Equal(retained, latest) {
		t.Fatalf("repair overwrote newer source: %v", err)
	}
}

func TestIndexFixRootRecreationRejectsStaleSnapshot(t *testing.T) {
	fixture := setupFileOperationTest(t)
	tree, original, err := filesys.LoadTreeSnapshot(fixture.box.ID, fixture.sourcePath, util.NewLute())
	if err != nil {
		t.Fatal(err)
	}
	newer, _, err := filesys.LoadTreeSnapshot(fixture.box.ID, fixture.sourcePath, util.NewLute())
	if err != nil {
		t.Fatal(err)
	}
	newer.Root.SetIALAttr("title", "New user edit")
	if _, err = filesys.WriteTree(newer); err != nil {
		t.Fatal(err)
	}
	abs := filepath.Join(util.DataDir, tree.Box, tree.Path)
	latest, err := os.ReadFile(abs)
	if err != nil {
		t.Fatal(err)
	}
	if err = recreateTree(tree, abs, original); !errors.Is(err, util.ErrFileChanged) {
		t.Fatalf("stale root recreation was not rejected: %v", err)
	}
	if err = removeIndexRepairSourceIfUnchanged(abs, original); !errors.Is(err, util.ErrFileChanged) {
		t.Fatalf("changed source removal was not rejected: %v", err)
	}
	retained, err := os.ReadFile(abs)
	if err != nil || !bytes.Equal(retained, latest) {
		t.Fatalf("root recreation changed newer source: %v", err)
	}
}

func TestIndexFixHistoryDoesNotOverwriteEarlierRepair(t *testing.T) {
	fixture := setupFileOperationTest(t)
	previousHistory := util.HistoryDir
	util.HistoryDir = t.TempDir()
	t.Cleanup(func() { util.HistoryDir = previousHistory })
	tree, original, err := filesys.LoadTreeSnapshot(fixture.box.ID, fixture.sourcePath, util.NewLute())
	if err != nil {
		t.Fatal(err)
	}
	for _, snapshot := range [][]byte{original, append(append([]byte{}, original...), '\n')} {
		if err = saveIndexRepairHistory(tree, snapshot); err != nil {
			t.Fatal(err)
		}
	}
	histories, err := filepath.Glob(filepath.Join(util.HistoryDir, "*-format", tree.Box, filepath.Base(tree.Path)))
	if err != nil || len(histories) != 2 {
		t.Fatalf("repair history was overwritten: %v %v", histories, err)
	}
	first, err := os.ReadFile(histories[0])
	if err != nil || !bytes.Equal(first, original) {
		t.Fatal("the earlier repair snapshot changed", err)
	}
}
