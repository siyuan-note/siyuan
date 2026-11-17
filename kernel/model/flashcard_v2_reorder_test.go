// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"context"
	flashcardv2 "github.com/siyuan-note/siyuan/kernel/flashcard"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
	"os"
	"path/filepath"
	"testing"
)

func TestFlashcardReorderInvalidRequestDoesNotOpenStore(t *testing.T) {
	old := util.DataDir
	util.DataDir = filepath.Join(t.TempDir(), "absent")
	defer func() { util.DataDir = old }()
	if _, err := ReorderFlashcardV2AdvancedSource(context.Background(), FlashcardV2ReorderSourceRequest{ReorderAdvancedSourceRequest: flashcardv2.ReorderAdvancedSourceRequest{}}); err == nil {
		t.Fatal("invalid request accepted")
	}
	if _, err := os.Stat(util.DataDir); !os.IsNotExist(err) {
		t.Fatal("invalid request opened storage", err)
	}
}

func TestFlashcardReorderRejectsClosedEncryptedAndMissingSources(t *testing.T) {
	oldData, oldDB := util.DataDir, util.BlockTreeDBPath
	root := t.TempDir()
	util.DataDir, util.BlockTreeDBPath = filepath.Join(root, "data"), filepath.Join(root, "blocktree.db")
	treenode.InitBlockTree(true)
	defer func() {
		treenode.CloseDatabase()
		util.DataDir, util.BlockTreeDBPath = oldData, oldDB
		if oldDB != "" {
			treenode.InitBlockTree(false)
		}
	}()
	boxID := "20261117000000-reorder"
	tree := treenode.NewTree(boxID, "/20261117000001-reorder.sy", "/Reorder", "Reorder")
	treenode.UpsertBlockTree(tree)
	dir := filepath.Join(util.DataDir, boxID, ".siyuan")
	if err := os.MkdirAll(dir, 0700); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, "conf.json")
	for _, body := range []string{`{"closed":false}`, `{"closed":true}`, `{"encrypted":true}`, `invalid`} {
		if err := os.WriteFile(path, []byte(body), 0600); err != nil {
			t.Fatal(err)
		}
		err := validateFlashcardV2ReorderBlocks([]string{tree.Root.ID})
		if (body == `{"closed":false}`) != (err == nil) {
			t.Fatalf("unexpected boundary %s: %v", body, err)
		}
	}
	if err := validateFlashcardV2ReorderBlocks([]string{"missing"}); err == nil {
		t.Fatal("missing accepted")
	}
	if err := validateFlashcardV2ReorderBlocks(nil); err == nil {
		t.Fatal("empty accepted")
	}
}
