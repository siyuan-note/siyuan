// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5 && (sqlcipher || libsqlcipher)

package model

import (
	"bytes"
	"encoding/json"
	"testing"
)

func TestEncryptedDocumentTitleHistoryRoundTrip(t *testing.T) {
	if !prepareStructuredTitlesCryptoTest(t) {
		return
	}
	boxID := newStructuredTitlesEncryptedBox(t)
	keys, err := json.Marshal(currentNotebookCrypto())
	if err != nil {
		t.Fatal(err)
	}
	testDocumentTitleHistoryRoundTrip(t, boxID)
	current, err := json.Marshal(currentNotebookCrypto())
	if err != nil || !bytes.Equal(keys, current) {
		t.Fatalf("title recovery changed key material: %v", err)
	}
}
