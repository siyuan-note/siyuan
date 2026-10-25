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
