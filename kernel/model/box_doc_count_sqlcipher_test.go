// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5 && (sqlcipher || libsqlcipher)

package model

import (
	"testing"

	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestBoxDocCountCacheEncryptedLifecycle(t *testing.T) {
	if !prepareStructuredTitlesCryptoTest(t) {
		return
	}
	box := newStructuredTitlesEncryptedBox(t)
	document := createStructuredTitlesEncryptedDoc(t, box, nil, "Private document")
	if got := BoxDocSubFileCount(box); got != 1 {
		t.Fatalf("encrypted count = %d, want 1", got)
	}
	if got := BoxDocSubFileCount(box); got != 1 {
		t.Fatalf("cached encrypted count = %d, want 1", got)
	}
	encryption, err := GetBoxEncryption(box)
	if err != nil {
		t.Fatal(err)
	}
	LockBox(box)
	if got := BoxDocSubFileCount(box); got != 0 {
		t.Fatalf("locked notebook exposed a cached count: %d", got)
	}
	if err := UnlockBox(box, structuredTitlesCryptoPassword, encryption); err != nil {
		t.Fatal(err)
	}
	tree, err := filesys.LoadTree(box, document.Path, util.NewLute())
	if err != nil {
		t.Fatal(err)
	}
	tree.Root.SetIALAttr(DocHiddenAttr, "true")
	if _, err := filesys.WriteTree(tree); err != nil {
		t.Fatal(err)
	}
	if got := BoxDocSubFileCount(box); got != 0 {
		t.Fatalf("unlock retained the old visible count: %d", got)
	}
}
