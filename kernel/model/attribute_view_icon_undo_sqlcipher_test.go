// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5 && (sqlcipher || libsqlcipher)

package model

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAttributeViewIconTransactionEncryptedUndoLog(t *testing.T) {
	for _, legacy := range []bool{false, true} {
		t.Run(fmt.Sprint(legacy), func(t *testing.T) {
			fixture, database, _ := setupStoredAutomationEncryptedTest(t)
			boxID := fixture.box.ID
			testAttributeViewIconTransactionUndoLog(t, fixture.sourceID, database, boxID, legacy)
			path := filepath.Join(util.DataDir, boxID, "storage", "av", database.ID+".json")
			ciphertext, err := os.ReadFile(path)
			if err != nil || !util.IsCiphertext(ciphertext) {
				t.Fatalf("database lost encryption: %v", err)
			}
			if _, err = os.Stat(filepath.Join(util.DataDir, "storage", "av", database.ID+".json")); !os.IsNotExist(err) {
				t.Fatal("replay produced plaintext database")
			}
			tree, err := LoadTreeByBlockID(fixture.sourceID)
			if err != nil {
				t.Fatal(err)
			}
			document, err := os.ReadFile(filepath.Join(util.DataDir, boxID, tree.Path))
			if err != nil || !util.IsCiphertext(document) {
				t.Fatalf("carrier lost encryption: %v", err)
			}
			ciphertext[len(ciphertext)-1] ^= 1
			if err = os.WriteFile(path, ciphertext, 0600); err != nil {
				t.Fatal(err)
			}
			cache.ClearAVCache()
			entry := GlobalUndoLog.Undo(fixture.sourceID)
			if entry == nil {
				t.Fatal("missing encrypted undo entry")
			}
			tx := &Transaction{DoOperations: entry.UndoOperationsForReplay()}
			tx.MarkReplay()
			if err = PerformTxSync(tx); err == nil {
				t.Fatal("replay accepted unauthenticated database")
			}
			GlobalUndoLog.UndoRollback(entry, fixture.sourceID)
			if GlobalUndoLog.Peek(fixture.sourceID) != entry {
				t.Fatal("failed replay lost undo entry")
			}
			preserved, err := os.ReadFile(path)
			if err != nil || !bytes.Equal(ciphertext, preserved) {
				t.Fatal("failed replay modified ciphertext")
			}
		})
	}
}
