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
	"slices"
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestCanonicalBlockKramdownIAL(t *testing.T) {
	ial := testBlockKramdownIAL(
		"custom-z", "title-img", "fold", "style", "icon", "tags", "bookmark", "memo", "alias", "name", "title",
		"type", "updated", "id", "custom-sy-readonly", "custom-riff-decks", "custom-reminder-wechat",
		"custom-heading-mode", "custom-avs", "unknown", "heading-fold", "custom-a",
	)
	originalNames := blockKramdownIALAttrNames(ial)

	canonical := canonicalBlockKramdownIAL(ial)

	assertBlockKramdownIALAttrNames(t, canonical, []string{
		"id", "updated", "type", "title", "name", "alias", "memo", "bookmark", "tags", "icon", "title-img", "style",
		"fold", "custom-avs", "custom-heading-mode", "custom-reminder-wechat", "custom-riff-decks", "custom-sy-readonly",
		"custom-a", "custom-z", "heading-fold", "unknown",
	})
	assertBlockKramdownIALAttrNames(t, ial, originalNames)
}

func TestGetBlockKramdownCanonicalBlockIAL(t *testing.T) {
	for _, mode := range []string{"md", "textmark"} {
		t.Run(mode, func(t *testing.T) {
			id := "20260730230437-v4c93el"
			ial := [][]string{
				{"custom-z", "z"},
				{"updated", "20260731125712"},
				{"custom-sy-readonly", "true"},
				{"id", id},
				{"custom-a", "a"},
			}
			originalNames := blockKramdownIALAttrNames(ial)
			root := &ast.Node{Type: ast.NodeDocument}
			paragraph := &ast.Node{Type: ast.NodeParagraph, ID: id, KramdownIAL: ial}
			paragraph.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("content")})
			root.AppendChild(paragraph)
			tree := &parse.Tree{Root: root}

			kramdown := getBlockKramdown0(tree, id, mode, util.NewLute())

			expectedIAL := `{: id="20260730230437-v4c93el" updated="20260731125712" ` +
				`custom-sy-readonly="true" custom-a="a" custom-z="z"}`
			if !strings.Contains(kramdown, expectedIAL) {
				t.Fatalf("unexpected Kramdown IAL: %q", kramdown)
			}
			assertBlockKramdownIALAttrNames(t, paragraph.KramdownIAL, originalNames)
		})
	}
}

func TestAddCanonicalBlockIALNodesIncludesChildBlocks(t *testing.T) {
	root := &ast.Node{Type: ast.NodeDocument}
	blockquote := &ast.Node{Type: ast.NodeBlockquote, KramdownIAL: testBlockKramdownIAL("custom-z", "updated", "id")}
	paragraph := &ast.Node{Type: ast.NodeParagraph, KramdownIAL: testBlockKramdownIAL("custom-b", "updated", "id", "custom-a")}
	blockquote.AppendChild(paragraph)
	root.AppendChild(blockquote)
	tree := &parse.Tree{Root: root}

	addCanonicalBlockIALNodes(tree, false)

	assertBlockKramdownIALAttrNames(t, parse.Tokens2IAL(blockquote.Next.Tokens), []string{"id", "updated", "custom-z"})
	assertBlockKramdownIALAttrNames(t, parse.Tokens2IAL(paragraph.Next.Tokens), []string{"id", "updated", "custom-a", "custom-b"})
}

func testBlockKramdownIAL(names ...string) (ret [][]string) {
	for _, name := range names {
		ret = append(ret, []string{name, name + "-value"})
	}
	return
}

func blockKramdownIALAttrNames(ial [][]string) (ret []string) {
	for _, attr := range ial {
		ret = append(ret, attr[0])
	}
	return
}

func assertBlockKramdownIALAttrNames(t *testing.T, ial [][]string, expected []string) {
	t.Helper()
	actual := blockKramdownIALAttrNames(ial)
	if !slices.Equal(actual, expected) {
		t.Fatalf("unexpected IAL attribute order: got %v, want %v", actual, expected)
	}
}
