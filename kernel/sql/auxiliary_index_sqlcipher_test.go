// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5 && (sqlcipher || libsqlcipher)

package sql

import (
	"bytes"
	"os"
	"reflect"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAuxiliaryIndexEncryptedUpdateAndReopen(t *testing.T) {
	previousTemp, previousDB, previousEncrypted, previousDir := util.TempDir, db, IsEncryptedBoxFn, util.DataDir
	previousCached, previousIgnore, previousDisabled := IndexIgnoreCached, indexIgnore, cacheDisabled
	util.TempDir, util.DataDir = t.TempDir(), t.TempDir()
	IndexIgnoreCached, indexIgnore, cacheDisabled = true, nil, true
	tree := newUpsertTestTree(3)
	db = newDeletePathTestDB(t, false)
	IsEncryptedBoxFn = func(id string) bool { return id == tree.Box || previousEncrypted != nil && previousEncrypted(id) }
	t.Cleanup(func() {
		CloseEncryptedDB(tree.Box)
		util.TempDir, db, IsEncryptedBoxFn, util.DataDir = previousTemp, previousDB, previousEncrypted, previousDir
		IndexIgnoreCached, indexIgnore, cacheDisabled = previousCached, previousIgnore, previousDisabled
		ClearCache()
	})
	execDeletePathTestSQL(t, db, "INSERT INTO attributes VALUES ('decoy', 'custom-note', 'plaintext decoy', 'b', ?, ?, ?, ?)",
		tree.Root.FirstChild.ID, tree.ID, tree.Box, tree.Path)
	decoy := auxiliaryTableSnapshot(t, db, attributeIndex, true)
	key := bytes.Repeat([]byte{39}, 32)
	if err := OpenEncryptedDB(tree.Box, key); err != nil {
		t.Fatal(err)
	}
	database := GetEncryptedDB(tree.Box)
	var version string
	if err := database.QueryRow("PRAGMA cipher_version").Scan(&version); err != nil || version == "" {
		t.Fatalf("SQLCipher required: %q, %v", version, err)
	}
	useChanges := false
	write := func(full bool) {
		t.Helper()
		tx, err := beginTxForBox(tree.Box)
		if err != nil {
			t.Fatal(err)
		}
		defer closeTxPreparedStmts(tx)
		defer tx.Rollback()
		if full {
			err = indexTree(tx, tree, nil)
		} else if useChanges {
			err = upsertTreeWithChanges(tx, tree, nil, NewTreeIndexChanges([]string{tree.Root.FirstChild.ID}))
		} else {
			err = upsertTree(tx, tree, nil)
		}
		if err == nil {
			err = commitTx(tx)
		}
		if err != nil {
			t.Fatal(err)
		}
	}
	write(true)
	want := upsertTableSnapshots(t, database, true)
	tree.Root.FirstChild.FirstChild.Tokens = []byte("changed private paragraph content ")
	write(false)
	got := upsertTableSnapshots(t, database, true)
	for _, table := range upsertTestTables[:5] {
		if !reflect.DeepEqual(got[table.name], want[table.name]) {
			t.Fatalf("unchanged encrypted %s records were rewritten", table.name)
		}
	}
	useChanges = true
	tree.Root.FirstChild.FirstChild.Tokens = []byte("private change-set update ")
	write(false)
	got = upsertTableSnapshots(t, database, true)
	for _, table := range upsertTestTables[:5] {
		if !reflect.DeepEqual(got[table.name], want[table.name]) {
			t.Fatalf("scoped encrypted update rewrote %s", table.name)
		}
	}
	// 重开旧版加密库时补建索引并保留已有数据。
	for _, table := range []auxiliaryIndexTable{spanIndex, assetIndex, attributeIndex} {
		execDeletePathTestSQL(t, database, "DROP INDEX idx_"+table.name+"_root_id")
	}
	CloseEncryptedDB(tree.Box)
	original, err := os.ReadFile(util.EncryptedDBPath(tree.Box))
	if err != nil || bytes.HasPrefix(original, []byte("SQLite format 3")) {
		t.Fatalf("expected encrypted database: %v", err)
	}
	if tx, err := beginTxForBox(tree.Box); err == nil {
		tx.Rollback()
		t.Fatal("locked update fell back to the global database")
	}
	if err = OpenEncryptedDB(tree.Box, bytes.Repeat([]byte{40}, 32)); err == nil {
		t.Fatal("wrong key accepted")
	}
	preserved, err := os.ReadFile(util.EncryptedDBPath(tree.Box))
	if err != nil || !bytes.Equal(original, preserved) || GetEncryptedDB(tree.Box) != nil {
		t.Fatal("failed authentication changed or registered the encrypted database")
	}
	for range 2 {
		if err = OpenEncryptedDB(tree.Box, key); err != nil {
			t.Fatal(err)
		}
		database = GetEncryptedDB(tree.Box)
		if reopened := upsertTableSnapshots(t, database, true); !reflect.DeepEqual(got, reopened) {
			t.Fatal("encrypted index migration changed existing records")
		}
		for _, table := range []auxiliaryIndexTable{spanIndex, assetIndex, attributeIndex} {
			rows, err := database.Query("SELECT rowid FROM "+table.name+" INDEXED BY idx_"+table.name+"_root_id WHERE root_id = ?", tree.ID)
			if err != nil {
				t.Fatal(err)
			}
			rows.Close()
		}
		write(false)
		CloseEncryptedDB(tree.Box)
	}
	if !reflect.DeepEqual(decoy, auxiliaryTableSnapshot(t, db, attributeIndex, true)) {
		t.Fatal("encrypted updates changed the global database")
	}
}
