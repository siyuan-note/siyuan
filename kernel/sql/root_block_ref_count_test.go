// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package sql

import (
	gosql "database/sql"
	"fmt"
	"maps"
	"testing"
)

func TestQueryRootBlockRefCounts(t *testing.T) {
	encrypted, _ := useEncryptedQueryTestDB(t)
	global, err := gosql.Open("sqlite3_extended", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer global.Close()
	previous := db
	db = global
	defer func() { db = previous }()
	if _, err = global.Exec("CREATE TABLE refs (def_block_root_id TEXT, block_id TEXT)"); err != nil {
		t.Fatal(err)
	}
	if _, err = global.Exec("INSERT INTO refs VALUES ('target', 'one'), ('target', 'one'), ('other', 'two')"); err != nil {
		t.Fatal(err)
	}
	if _, err = encrypted.Exec("INSERT INTO refs (def_block_root_id, block_id) VALUES ('target', 'three'), ('last', 'four')"); err != nil {
		t.Fatal(err)
	}

	ids := []string{"target"}
	for i := range queryRefsByDefIDsBatchSize {
		ids = append(ids, fmt.Sprintf("missing-%d", i))
	}
	ids = append(ids, "last", "target")
	if counts := QueryRootBlockRefCounts(ids); !maps.Equal(counts, map[string]int{"target": 2, "last": 1}) {
		t.Fatalf("unexpected scoped root counts: %v", counts)
	}
	if counts := QueryRootBlockRefCounts(nil); len(counts) != 0 {
		t.Fatalf("empty input returned counts: %v", counts)
	}
}
