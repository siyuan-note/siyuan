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
