// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package sql

import (
	stdsql "database/sql"
	"testing"
)

func TestEmbeddingSpaceMigrationPreservesLegacy(t *testing.T) {
	database, err := stdsql.Open("sqlite3_extended", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	database.SetMaxOpenConns(1)
	previous := db
	db = database
	defer func() { db = previous }()
	if _, err = database.Exec("CREATE TABLE block_embeddings (id TEXT PRIMARY KEY, embedding BLOB, model TEXT)"); err != nil {
		t.Fatal(err)
	}
	if _, err = database.Exec("INSERT INTO block_embeddings VALUES ('legacy', x'01020304', 'old-model')"); err != nil {
		t.Fatal(err)
	}
	for range 2 {
		migrateBlockEmbeddingsSchema()
	}
	var vector []byte
	var model, space string
	if err = database.QueryRow("SELECT embedding, model, space FROM block_embeddings WHERE id = 'legacy'").Scan(&vector, &model, &space); err != nil {
		t.Fatal(err)
	}
	if len(vector) != 4 || model != "old-model" || space != "" {
		t.Fatalf("legacy result changed: %x, %q, %q", vector, model, space)
	}
}
