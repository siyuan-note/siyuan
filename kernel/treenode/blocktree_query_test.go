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

package treenode

import (
	"database/sql"
	"path/filepath"
	"slices"
	"testing"

	"github.com/mattn/go-sqlite3"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func init() {
	sql.Register("sqlite3_extended", &sqlite3.SQLiteDriver{})
}

func TestGetRootBlockIDsByBoxID(t *testing.T) {
	const (
		boxID      = "20260730000000-box0001"
		otherBoxID = "20260730000001-box0002"
		docID      = "20260730000002-doc0001"
		otherDocID = "20260730000003-doc0002"
	)

	previousBlockTreeDBPath := util.BlockTreeDBPath
	util.BlockTreeDBPath = filepath.Join(t.TempDir(), "blocktree.db")
	InitBlockTree(true)
	t.Cleanup(func() {
		CloseDatabase()
		util.BlockTreeDBPath = previousBlockTreeDBPath
		if "" != previousBlockTreeDBPath {
			InitBlockTree(false)
		}
	})

	UpsertBlockTree(NewTree(boxID, "/"+docID+".sy", "/Document", "Document"))
	UpsertBlockTree(NewTree(otherBoxID, "/"+otherDocID+".sy", "/Other", "Other"))

	if rootIDs := GetRootBlockIDsByBoxID(boxID); !slices.Equal(rootIDs, []string{docID}) {
		t.Fatalf("unexpected document root IDs: %v", rootIDs)
	}
}
