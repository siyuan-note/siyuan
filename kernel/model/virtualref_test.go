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
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestProcessVirtualRefDoesNotMatchHTMLEntity(t *testing.T) {
	previousConf := Conf
	Conf = NewAppConf()
	Conf.Editor = conf.NewEditor()
	Conf.Search = conf.NewSearch()
	Conf.Editor.VirtualBlockRef = true
	t.Cleanup(func() {
		Conf = previousConf
	})

	const blockDOM = `<div data-node-id="20260725010000-abcdefg" data-type="NodeParagraph" class="p"><div contenteditable="true" spellcheck="false">amp A&amp;B</div><div class="protyle-attr" contenteditable="false"></div></div>`
	luteEngine := util.NewLute()
	tree := luteEngine.BlockDOM2Tree(blockDOM)

	var textNode *ast.Node
	ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
		if entering && ast.NodeText == n.Type && "amp A&B" == string(n.Tokens) {
			textNode = n
			return ast.WalkStop
		}
		return ast.WalkContinue
	})
	if nil == textNode {
		t.Fatal("BlockDOM 中的 & 没有生成预期的文本节点")
	}

	var unlinks []*ast.Node
	if !processVirtualRef(textNode, &unlinks, []string{"amp"}, map[string]int{}, luteEngine) {
		t.Fatal("真实的 amp 没有生成虚拟引用")
	}
	for _, unlink := range unlinks {
		unlink.Unlink()
	}

	var virtualRefContents []string
	ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
		if entering && ast.NodeTextMark == n.Type && n.IsTextMarkType("virtual-block-ref") {
			virtualRefContents = append(virtualRefContents, n.TextMarkTextContent)
		}
		return ast.WalkContinue
	})
	if 1 != len(virtualRefContents) || "amp" != virtualRefContents[0] {
		t.Fatalf("virtual references = %q, want [amp]", virtualRefContents)
	}
}

func TestMarkReplaceSpanWithSplitReportsFinalMatch(t *testing.T) {
	previousConf := Conf
	Conf = NewAppConf()
	Conf.Search = conf.NewSearch()
	t.Cleanup(func() {
		Conf = previousConf
	})

	start := "<span data-type=\"virtual-block-ref\">"
	got, matched := markReplaceSpanWithSplit("中a", []string{"中"}, start, "</span>")
	if "中a" != got {
		t.Fatalf("result = %q, want %q", got, "中a")
	}
	if matched {
		t.Fatal("已被边界处理撤销的高亮仍返回命中状态")
	}
}
