// SiYuan - Refactor your thinking
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

package sql

import (
	"database/sql"
	"os"
	"path/filepath"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestInitBlockTreeRebuildsReadonlyLegacyDatabase(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "blocktree.db")

	legacyDB, err := sql.Open("sqlite3_extended", dbPath)
	if err != nil {
		t.Fatalf("open legacy blocktree database failed: %s", err)
	}
	if _, err = legacyDB.Exec("CREATE TABLE legacy (id TEXT)"); err != nil {
		legacyDB.Close()
		t.Fatalf("create legacy table failed: %s", err)
	}
	if err = legacyDB.Close(); err != nil {
		t.Fatalf("close legacy database failed: %s", err)
	}
	if err = os.Chmod(dbPath, 0o444); err != nil {
		t.Fatalf("chmod legacy database failed: %s", err)
	}

	origDBPath := util.BlockTreeDBPath
	util.BlockTreeDBPath = dbPath
	t.Cleanup(func() {
		treenode.CloseDatabase()
		util.BlockTreeDBPath = origDBPath
		_ = os.Chmod(dbPath, 0o644)
		util.RemoveDatabaseFile(dbPath)
	})

	treenode.InitBlockTree(false)

	checkDB, err := sql.Open("sqlite3_extended", dbPath)
	if err != nil {
		t.Fatalf("open rebuilt blocktree database failed: %s", err)
	}
	defer checkDB.Close()

	var table string
	if err = checkDB.QueryRow("SELECT name FROM sqlite_master WHERE type = ? AND name = ?", "table", "blocktrees").Scan(&table); err != nil {
		t.Fatalf("query rebuilt blocktrees table failed: %s", err)
	}
	if "blocktrees" != table {
		t.Fatalf("unexpected table name after rebuild: %s", table)
	}
}
