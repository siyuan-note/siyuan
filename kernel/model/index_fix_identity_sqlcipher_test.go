// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5 && (sqlcipher || libsqlcipher)

package model

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestIndexFixEncryptedDuplicateIdentity(t *testing.T) {
	if !prepareStructuredTitlesCryptoTest(t) {
		return
	}
	box := newStructuredTitlesEncryptedBox(t)
	first := createStructuredTitlesEncryptedDoc(t, box, nil, "First")
	second := createStructuredTitlesEncryptedDoc(t, box, nil, "Second")
	if first.Path > second.Path {
		first, second = second, first
	}
	source, _, err := filesys.ReadTreeSnapshot(box, first.Path)
	if err != nil {
		t.Fatal(err)
	}
	target, _, err := filesys.ReadTreeSnapshot(box, second.Path)
	if err != nil {
		t.Fatal(err)
	}
	duplicateID := source.Root.FirstChild.ID
	target.Root.FirstChild.ID = duplicateID
	target.Root.FirstChild.SetIALAttr("id", duplicateID)
	if _, err = filesys.WriteTree(target); err != nil {
		t.Fatal(err)
	}
	original := structuredTitlesCiphertext(t, second)
	if err = resetDuplicateBlocksOnFileSys(); err != nil {
		t.Fatal(err)
	}
	sql.FlushQueue()
	repaired, _, err := filesys.ReadTreeSnapshot(box, second.Path)
	if err != nil || repaired.Root.FirstChild.ID == duplicateID {
		t.Fatalf("encrypted duplicate was not repaired: %v", err)
	}
	assertIndexRepairDocument(t, source)
	assertIndexRepairDocument(t, repaired)
	if sql.GetBlock(repaired.Root.FirstChild.ID) != nil {
		t.Fatal("private repaired block leaked into the global SQL index")
	}
	histories, err := filepath.Glob(filepath.Join(util.HistoryDir, "*-format", box, filepath.Base(second.Path)))
	if err != nil || len(histories) != 1 {
		t.Fatalf("encrypted repair history missing: %v %v", histories, err)
	}
	backup, err := os.ReadFile(histories[0])
	if err != nil || !bytes.Equal(backup, original) {
		t.Fatal("encrypted repair history lost the exact ciphertext", err)
	}
	// A duplicate identity in another encryption boundary is independent and remains untouched.
	otherBox := newStructuredTitlesEncryptedBox(t)
	other := createStructuredTitlesEncryptedDoc(t, otherBox, nil, "Independent")
	otherTree, _, err := filesys.ReadTreeSnapshot(otherBox, other.Path)
	if err != nil {
		t.Fatal(err)
	}
	otherTree.Root.FirstChild.ID = duplicateID
	otherTree.Root.FirstChild.SetIALAttr("id", duplicateID)
	if err = indexWriteTreeUpsertQueue(otherTree); err != nil {
		t.Fatal(err)
	}
	before := structuredTitlesCiphertext(t, other)
	if err = resetDuplicateBlocksOnFileSys(); err != nil {
		t.Fatal(err)
	}
	assertEncryptedFileBytes(t, filepath.Join(util.DataDir, otherBox, other.Path), before)
}
