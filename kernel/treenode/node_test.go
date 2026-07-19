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
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/html"
)

func TestGetDocTitleImgPath(t *testing.T) {
	tests := []struct {
		name     string
		titleImg string
		expected string
	}{
		{
			name:     "image URL",
			titleImg: `background-image:url("assets/cover.png");object-position:center 20%;`,
			expected: "assets/cover.png",
		},
		{
			name:     "built-in gradient",
			titleImg: "background:linear-gradient(#fff 50%, transparent 0);background-size:20px 20px;",
		},
		{
			name:     "attribute injection",
			titleImg: `background:red;" onload="require('child_process')" x="`,
		},
		{
			name:     "missing closing parenthesis",
			titleImg: `background-image:url("assets/cover.png"`,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			root := &ast.Node{KramdownIAL: [][]string{{"title-img", html.EscapeAttrVal(test.titleImg)}}}
			if actual := GetDocTitleImgPath(root); test.expected != actual {
				t.Fatalf("expected %q, got %q", test.expected, actual)
			}
		})
	}
}

func TestGetEmbedBlockRef(t *testing.T) {
	const blockID = "20060102150405-1a2b3c4"
	tests := []struct {
		name     string
		stmt     string
		expected string
	}{
		{name: "exact ID", stmt: "SELECT * FROM blocks WHERE id = '" + blockID + "'", expected: blockID},
		{name: "quoted ID column", stmt: "SELECT * FROM blocks WHERE `id` = '" + blockID + "'", expected: blockID},
		{name: "qualified ID column", stmt: "SELECT * FROM blocks WHERE blocks.id = '" + blockID + "'", expected: blockID},
		{name: "parenthesized condition", stmt: "SELECT * FROM blocks WHERE ((id = '" + blockID + "'))", expected: blockID},
		{name: "limited exact ID", stmt: "SELECT * FROM blocks WHERE id = '" + blockID + "' LIMIT 1", expected: blockID},
		{name: "not equal", stmt: "SELECT * FROM blocks WHERE id != '" + blockID + "'"},
		{name: "additional condition", stmt: "SELECT * FROM blocks WHERE id = '" + blockID + "' AND type = 'd'"},
		{name: "alternative condition", stmt: "SELECT * FROM blocks WHERE id = '" + blockID + "' OR type = 'd'"},
		{name: "ID list", stmt: "SELECT * FROM blocks WHERE id IN ('" + blockID + "')"},
		{name: "ID pattern", stmt: "SELECT * FROM blocks WHERE id LIKE '" + blockID + "'"},
		{name: "reversed comparison", stmt: "SELECT * FROM blocks WHERE '" + blockID + "' = id"},
		{name: "other column", stmt: "SELECT * FROM blocks WHERE parent_id = '" + blockID + "'"},
		{name: "numeric value", stmt: "SELECT * FROM blocks WHERE id = 20060102150405"},
		{name: "invalid ID", stmt: "SELECT * FROM blocks WHERE id = 'invalid'"},
		{name: "non-select statement", stmt: "DELETE FROM blocks WHERE id = '" + blockID + "'"},
		{name: "invalid SQL", stmt: "SELECT FROM"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if actual := GetEmbedBlockRefID(test.stmt); test.expected != actual {
				t.Fatalf("expected raw statement result %q, got %q", test.expected, actual)
			}

			embedNode := &ast.Node{Type: ast.NodeBlockQueryEmbed}
			embedNode.AppendChild(&ast.Node{Type: ast.NodeBlockQueryEmbedScript, Tokens: []byte(test.stmt)})
			if actual := GetEmbedBlockRef(embedNode); test.expected != actual {
				t.Fatalf("expected %q, got %q", test.expected, actual)
			}
		})
	}
}
