// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5 && (sqlcipher || libsqlcipher)

package model

import "testing"

func TestEncryptedNotebookDocumentHistoryTitle(t *testing.T) {
	if !prepareStructuredTitlesCryptoTest(t) {
		return
	}
	testNotebookDocumentHistoryTitle(t, newStructuredTitlesEncryptedBox)
}

func TestEncryptedNotebookDocumentHistoryTitleRecovery(t *testing.T) {
	if !prepareStructuredTitlesCryptoTest(t) {
		return
	}
	testNotebookDocumentHistoryTitleRecovery(t, newStructuredTitlesEncryptedBox)
}
