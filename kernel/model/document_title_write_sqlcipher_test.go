// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5 && (sqlcipher || libsqlcipher)

package model

import "testing"

func TestDocumentTitleEncryptedConditionalCommit(t *testing.T) {
	if !documentTitleFeatureTestProcess(t) {
		return
	}
	prepareHPathRefreshTest(t)
	t.Cleanup(backgroundRefreshWaitGroup.Wait)
	const password = "document-title-write-password"
	if err := EnableEncryptedNotebook(password); err != nil {
		t.Fatal(err)
	}
	boxID, err := CreateEncryptedBox("Title/Write", password)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = Mount(boxID); err != nil {
		t.Fatal(err)
	}
	testDocumentTitleConditionalCommit(t, boxID)
	testDocumentTitleCommitDescendantPaths(t, boxID)
	testDocumentTitlePlainStorage(t, boxID)
}
