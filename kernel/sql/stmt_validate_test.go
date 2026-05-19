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

import "testing"

func TestTailIsOnlyWhitespaceOrSQLComments(t *testing.T) {
	tests := []struct {
		s    string
		want bool
	}{
		{"", true},
		{"   \n\t", true},
		{"-- foo", true},
		{"-- foo\n", true},
		{"/* */", true},
		{"  /* x */  \n--y", true},
		{"/* no close ", true},
		{"SELECT 1", false},
		{"-- a\nSELECT 1", false},
		{"/* */;", false},
	}
	for _, tt := range tests {
		if got := tailIsOnlyWhitespaceOrSQLComments(tt.s); got != tt.want {
			t.Errorf("tailIsOnlyWhitespaceOrSQLComments(%q) = %v, want %v", tt.s, got, tt.want)
		}
	}
}

func TestContainsMultipleStatements(t *testing.T) {
	tests := []struct {
		stmt string
		want bool
	}{
		{"SELECT 1 AS n; -- 尾部注释", false},
		{"SELECT 1 AS n; -- 注释\n", false},
		{"SELECT 1 AS n; /* 仅注释 */", false},
		{"SELECT 1 AS n;   \n\t  ", false},
		{"SELECT 'a''b;c' AS s", false},
		{"SELECT 1 AS `a;b`", false},
		{"SELECT 1 AS [a;b]", false},
		{"SELECT 1; SELECT 2", true},
		{"SELECT 1; -- a\nSELECT 2", true},
		{"SELECT 1;/* */;SELECT 2", true},
	}
	for _, tt := range tests {
		if got := containsMultipleStatements(tt.stmt); got != tt.want {
			t.Errorf("containsMultipleStatements(%q) = %v, want %v", tt.stmt, got, tt.want)
		}
	}
}
