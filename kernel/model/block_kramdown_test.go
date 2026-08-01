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

package model

import (
	"slices"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
)

func TestCanonicalizeBlockKramdownIAL(t *testing.T) {
	root := &ast.Node{Type: ast.NodeDocument, KramdownIAL: testBlockKramdownIAL(
		"custom-z", "title-img", "fold", "style", "icon", "tags", "bookmark", "memo", "alias", "name", "title",
		"type", "updated", "id", "custom-sy-readonly", "custom-riff-decks", "custom-reminder-wechat",
		"custom-heading-mode", "custom-avs", "unknown", "heading-fold", "custom-a",
	)}
	paragraph := &ast.Node{Type: ast.NodeParagraph, KramdownIAL: testBlockKramdownIAL(
		"custom-b", "updated", "id", "custom-sy-heading-number", "custom-a",
	)}
	textMark := &ast.Node{Type: ast.NodeTextMark, KramdownIAL: testBlockKramdownIAL("z", "a")}
	paragraph.AppendChild(textMark)
	root.AppendChild(paragraph)
	tree := &parse.Tree{Root: root}

	canonicalizeBlockKramdownIAL(tree)

	assertBlockKramdownIALAttrNames(t, root.KramdownIAL, []string{
		"id", "updated", "type", "title", "name", "alias", "memo", "bookmark", "tags", "icon", "title-img", "style",
		"fold", "custom-avs", "custom-heading-mode", "custom-reminder-wechat", "custom-riff-decks", "custom-sy-readonly",
		"custom-a", "custom-z", "heading-fold", "unknown",
	})
	assertBlockKramdownIALAttrNames(t, paragraph.KramdownIAL, []string{
		"id", "updated", "custom-sy-heading-number", "custom-a", "custom-b",
	})
	assertBlockKramdownIALAttrNames(t, textMark.KramdownIAL, []string{"z", "a"})
}

func testBlockKramdownIAL(names ...string) (ret [][]string) {
	for _, name := range names {
		ret = append(ret, []string{name, name + "-value"})
	}
	return
}

func assertBlockKramdownIALAttrNames(t *testing.T, ial [][]string, expected []string) {
	t.Helper()
	var actual []string
	for _, attr := range ial {
		actual = append(actual, attr[0])
	}
	if !slices.Equal(actual, expected) {
		t.Fatalf("unexpected IAL attribute order: got %v, want %v", actual, expected)
	}
}
