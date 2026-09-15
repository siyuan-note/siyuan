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
	"html"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// 标签面板的展示文本必须是纯文本：模型层转义存储、API 层还原，前端负责按上下文转义，
// 否则前端会对已转义文本再转义一次，含 & 或 < 的标签会显示为 a&amp;b
func TestTagNameIsPlainTextForFrontend(t *testing.T) {
	for _, label := range []string{"a&b", "a<b", "it's", `a"b`, "plain", "标题"} {
		tags := buildTags(Tags{}, []string{label}, 0)
		if 1 > len(tags) {
			t.Fatalf("buildTags(%q) returned nothing", label)
		}

		// 模型层保持转义形态
		if util.EscapeHTML(label) != tags[0].Name {
			t.Errorf("label=%q modelName=%q, want escaped form", label, tags[0].Name)
		}
		// API 层还原为纯文本，前端据此再转义一次
		if plain := util.UnescapeHTML(tags[0].Name); plain != label {
			t.Errorf("label=%q plainName=%q, want plain text", label, plain)
		}
	}
}

// 书签面板的展示文本必须是纯文本，且重命名/删除的比较值要与之相等，
// 否则标签含 & 或 < 的书签无法重命名和删除，且没有任何报错
func TestBookmarkLabelComparisonIsConsistent(t *testing.T) {
	for _, label := range []string{"R&D", "a<b", `a"b`, "it's", "plain"} {
		node := &ast.Node{Type: ast.NodeParagraph}
		node.SetIALAttr("bookmark", label)

		// BuildBookmark 取 blocks.ial 的原样存储值并还原为纯文本
		var stored string
		for _, kv := range node.KramdownIAL {
			if "bookmark" == kv[0] {
				stored = kv[1]
			}
		}
		displayed := html.UnescapeString(stored)
		if displayed != label {
			t.Errorf("label=%q displayed=%q, want plain text", label, displayed)
		}

		// 前端按纯文本回传，内核比较前同样还原
		if got := node.IALAttr("bookmark"); got != html.UnescapeString(displayed) {
			t.Errorf("label=%q compare=%q displayed=%q, mismatched", label, got, displayed)
		}
	}
}
