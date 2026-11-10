// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package treenode

import (
	"database/sql"
	"errors"
	"testing"
)

func TestMemoryBlockLookupDistinguishesUnavailableAndMissing(t *testing.T) {
	previous := db
	t.Cleanup(func() { initDatabaseLock.Lock(); db = previous; initDatabaseLock.Unlock() })
	initDatabaseLock.Lock()
	db = nil
	initDatabaseLock.Unlock()
	if _, err := LookupBlockTree("missing"); !errors.Is(err, errBlockTreeDBUnavailable) {
		t.Fatalf("unavailable index became deletion: %v", err)
	}
	database, err := sql.Open("sqlite3_extended", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { database.Close() })
	if _, err = database.Exec("CREATE TABLE blocktrees (id, root_id, parent_id, box_id, path, hpath, updated, type)"); err != nil {
		t.Fatal(err)
	}
	initDatabaseLock.Lock()
	db = database
	initDatabaseLock.Unlock()
	if _, err = LookupBlockTree("missing"); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("missing block: %v", err)
	}
	if _, err = database.Exec("INSERT INTO blocktrees VALUES ('block','doc','doc','box','/doc.sy','/Document','2026','p')"); err != nil {
		t.Fatal(err)
	}
	entry, err := LookupBlockTree("block")
	if err != nil || entry == nil || entry.RootID != "doc" {
		t.Fatalf("existing block: %+v %v", entry, err)
	}
	if GetBlockTree("block") == nil || GetBlockTree("missing") != nil {
		t.Fatal("legacy lookup behavior changed")
	}
}
