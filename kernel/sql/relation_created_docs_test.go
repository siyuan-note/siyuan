// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package sql

import (
	gosql "database/sql"
	"testing"

	"github.com/88250/lute/parse"
)

func newRelationCreatedRefsTestDB(t *testing.T) *gosql.DB {
	t.Helper()
	database, err := gosql.Open("sqlite3_extended", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	database.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = database.Close() })
	if _, err = database.Exec("CREATE TABLE refs (root_id TEXT, def_block_root_id TEXT)"); err != nil {
		t.Fatal(err)
	}
	return database
}

func setupRelationCreatedRefsTest(t *testing.T) *gosql.DB {
	t.Helper()
	database := newRelationCreatedRefsTestDB(t)
	initDatabaseLock.Lock()
	dbQueueLock.Lock()
	oldDB, oldQueue, oldEncrypted := db, operationQueue, IsEncryptedBoxFn
	db, operationQueue = database, nil
	IsEncryptedBoxFn = func(string) bool { return false }
	dbQueueLock.Unlock()
	initDatabaseLock.Unlock()
	t.Cleanup(func() {
		initDatabaseLock.Lock()
		dbQueueLock.Lock()
		db, operationQueue, IsEncryptedBoxFn = oldDB, oldQueue, oldEncrypted
		dbQueueLock.Unlock()
		initDatabaseLock.Unlock()
	})
	return database
}

func insertRelationCreatedRef(t *testing.T, database *gosql.DB, source, target string) {
	t.Helper()
	if _, err := database.Exec("INSERT INTO refs (root_id, def_block_root_id) VALUES (?, ?)", source, target); err != nil {
		t.Fatal(err)
	}
}

func TestRelationCreatedDocumentReferences(t *testing.T) {
	database := setupRelationCreatedRefsTest(t)
	const target = "created-leaf"
	owned := map[string]bool{target: true, "created-parent": true}
	insertRelationCreatedRef(t, database, target, target)
	insertRelationCreatedRef(t, database, "created-parent", target)
	insertRelationCreatedRef(t, database, "created-parent", target)
	insertRelationCreatedRef(t, database, "external-document", "another-definition")
	if used, err := HasDocumentRefsOutsideRootsInBox(target, owned, ""); err != nil || used {
		t.Fatalf("references inside the created document set prevented cleanup: %v %v", used, err)
	}
	if used, err := HasDocumentRefsOutsideRootsInBox("missing-definition", owned, ""); err != nil || used {
		t.Fatalf("unrelated references prevented cleanup: %v %v", used, err)
	}
	insertRelationCreatedRef(t, database, "external-document", target)
	owned["external-document"] = false
	if used, err := HasDocumentRefsOutsideRootsInBox(target, owned, ""); err != nil || !used {
		t.Fatalf("an external reference was treated as owned: %v %v", used, err)
	}
	owned["external-document"] = true
	if used, err := HasDocumentRefsOutsideRootsInBox(target, owned, ""); err != nil || used {
		t.Fatalf("fully owned references were treated as external: %v %v", used, err)
	}
	if used, err := HasDocumentRefsOutsideRootsInBox(target, nil, ""); err != nil || !used {
		t.Fatalf("an empty ownership set suppressed external references: %v %v", used, err)
	}
	var count int
	if err := database.QueryRow("SELECT COUNT(*) FROM refs").Scan(&count); err != nil || count != 5 {
		t.Fatalf("reference checks changed the source rows: %d %v", count, err)
	}
}

func TestRelationCreatedDocumentReferenceErrors(t *testing.T) {
	for _, test := range []struct {
		name string
		fail func(*testing.T, *gosql.DB)
	}{
		{"missing database", func(t *testing.T, database *gosql.DB) {
			initDatabaseLock.Lock()
			db = nil
			initDatabaseLock.Unlock()
		}},
		{"query failure", func(t *testing.T, database *gosql.DB) {
			if _, err := database.Exec("DROP TABLE refs"); err != nil {
				t.Fatal(err)
			}
		}},
		{"invalid reference row", func(t *testing.T, database *gosql.DB) {
			if _, err := database.Exec("INSERT INTO refs (root_id, def_block_root_id) VALUES (NULL, 'created-leaf')"); err != nil {
				t.Fatal(err)
			}
		}},
	} {
		t.Run(test.name, func(t *testing.T) {
			database := setupRelationCreatedRefsTest(t)
			test.fail(t, database)
			if used, err := HasDocumentRefsOutsideRootsInBox("created-leaf", map[string]bool{"created-leaf": true}, ""); err == nil || used {
				t.Fatalf("unavailable reference evidence was accepted: %v %v", used, err)
			}
		})
	}
}

func TestRelationCreatedDocumentReferencesRejectPendingIndex(t *testing.T) {
	database := setupRelationCreatedRefsTest(t)
	const target = "created-leaf"
	owned := map[string]bool{"created-parent": true}
	insertRelationCreatedRef(t, database, "created-parent", target)
	// 模拟正文已提交但引用索引更新未成功；旧索引仍能正常读取，且尚无外部引用。
	var count int
	if err := database.QueryRow("SELECT COUNT(*) FROM refs WHERE def_block_root_id = ?", target).Scan(&count); err != nil || count != 1 {
		t.Fatalf("pending-index fixture must remain readable: %d %v", count, err)
	}
	pending := &dbQueueOperation{action: "update_refs", upsertTree: &parse.Tree{ID: "external-document"}}
	dbQueueLock.Lock()
	operationQueue = []*dbQueueOperation{pending}
	dbQueueLock.Unlock()
	for _, id := range []string{target, "missing-definition"} {
		if used, err := HasDocumentRefsOutsideRootsInBox(id, owned, ""); err == nil || used {
			t.Fatalf("readable but stale references allowed cleanup for %s: %v %v", id, used, err)
		}
	}
	dbQueueLock.Lock()
	retained := len(operationQueue) == 1 && operationQueue[0] == pending
	operationQueue = nil
	dbQueueLock.Unlock()
	if !retained {
		t.Fatal("reference check consumed or replaced pending index work")
	}
	if used, err := HasDocumentRefsOutsideRootsInBox(target, owned, ""); err != nil || used {
		t.Fatalf("settled owned references still blocked cleanup: %v %v", used, err)
	}
}

func TestRelationCreatedDocumentReferencesEncryptedBoundary(t *testing.T) {
	ordinary := setupRelationCreatedRefsTest(t)
	boxA, boxB := t.Name()+"-a", t.Name()+"-b"
	databaseA, databaseB := newRelationCreatedRefsTestDB(t), newRelationCreatedRefsTestDB(t)
	encryptedDBs.Store(boxA, databaseA)
	encryptedDBs.Store(boxB, databaseB)
	IsEncryptedBoxFn = func(boxID string) bool { return boxID == boxA || boxID == boxB }
	t.Cleanup(func() {
		encryptedDBs.Delete(boxA)
		encryptedDBs.Delete(boxB)
	})
	const target = "same-definition-id"
	owned := map[string]bool{"created-parent": true}
	insertRelationCreatedRef(t, ordinary, "ordinary-external", target)
	insertRelationCreatedRef(t, databaseA, "created-parent", target)
	insertRelationCreatedRef(t, databaseB, "box-b-external", target)
	for _, test := range []struct {
		boxID string
		want  bool
	}{{"", true}, {boxA, false}, {boxB, true}} {
		used, err := HasDocumentRefsOutsideRootsInBox(target, owned, test.boxID)
		if err != nil || used != test.want {
			t.Fatalf("same-ID references crossed the exact database boundary %q: %v %v", test.boxID, used, err)
		}
	}
	// 已锁定的加密边界不能用普通或另一个加密笔记本的同 ID 引用代替。
	encryptedDBs.Delete(boxA)
	if used, err := HasDocumentRefsOutsideRootsInBox(target, owned, boxA); err == nil || used {
		t.Fatalf("locked reference scope fell back to another database: %v %v", used, err)
	}
}
