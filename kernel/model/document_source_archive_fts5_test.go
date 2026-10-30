// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5

package model

import (
	"bytes"
	"os"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/treenode"
)

func TestDocumentSourceArchiveIndexesBeforeBootSync(t *testing.T) {
	f, j := sourceArchiveFixture(t)
	setupFoldTransactionDatabase(t, f)
	if err := j.save(); err != nil {
		t.Fatal(err)
	}
	name, _ := j.Files[0].filename()
	current := append(append([]byte{}, j.Files[0].After...), '\n')
	if err := os.WriteFile(name, current, 0600); err != nil {
		t.Fatal(err)
	}
	if err := recoverDocumentSources(); err != nil {
		t.Fatal(err)
	}
	if err := prepareDocumentSourceBootSync(); err != nil {
		t.Fatal(err)
	}
	if hasDocumentSourceRecovery(f.box.ID) || treenode.DocumentMetadataState(f.box.ID) != "ready" {
		t.Fatal("startup sync would run before recovery indexing")
	}
	actual, err := os.ReadFile(name)
	if err != nil || !bytes.Equal(actual, current) {
		t.Fatal("boot indexing changed adopted source", err)
	}
}
