// SiYuan - From thought to insight, with agents
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

package model

import (
	"reflect"
	"testing"
)

func TestBuildRecentDocsByTimeStmt(t *testing.T) {
	tests := []struct {
		name          string
		sortBy        string
		hiddenRootIDs []string
		limit         int
		wantStmt      string
		wantArgs      []any
	}{
		{
			name:     "created",
			sortBy:   "created",
			limit:    32,
			wantStmt: "SELECT * FROM blocks WHERE type = 'd' ORDER BY created DESC, id DESC LIMIT 32",
		},
		{
			name:          "updated with hidden documents",
			sortBy:        "updated",
			hiddenRootIDs: []string{"20260822120000-abcdefg", "20260822120001-hijklmn"},
			limit:         64,
			wantStmt:      "SELECT * FROM blocks WHERE type = 'd' AND root_id NOT IN (?, ?) ORDER BY updated DESC, id DESC LIMIT 64",
			wantArgs:      []any{"20260822120000-abcdefg", "20260822120001-hijklmn"},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			stmt, args := buildRecentDocsByTimeStmt(test.sortBy, test.hiddenRootIDs, test.limit)
			if test.wantStmt != stmt {
				t.Fatalf("unexpected statement: got %q, want %q", stmt, test.wantStmt)
			}
			if !reflect.DeepEqual(test.wantArgs, args) {
				t.Fatalf("unexpected arguments: got %#v, want %#v", args, test.wantArgs)
			}
		})
	}
}
