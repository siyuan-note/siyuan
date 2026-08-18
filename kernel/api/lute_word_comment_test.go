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

package api

import (
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/PuerkitoBio/goquery"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestNormalizeMSWordComments(t *testing.T) {
	dom := `<p>before<a style="mso-comment-reference:TA_1">annotated</a>` +
		`<span class="MsoCommentReference"><a class="msocomanchor" href="#_msocom_1">[TA1]</a></span>after</p>` +
		`<div style="mso-element:comment-list"><hr class="msocomoff"><div id="_com_1" class="msocomtxt">` +
		`<p class="MsoCommentText"><span class="MsoCommentReference">[TA1]</span>memo</p></div></div>`

	normalized := normalizeMSWordComments(dom)
	doc, err := goquery.NewDocumentFromReader(strings.NewReader(normalized))
	if err != nil {
		t.Fatal(err)
	}
	memo := doc.Find(`span[title="memo"]`)
	if memo.Length() != 1 || memo.Text() != "annotated" {
		t.Fatalf("unexpected normalized memo: %s", normalized)
	}
	if doc.Find("a, hr, .MsoCommentReference, .msocomtxt").Length() != 0 {
		t.Fatalf("Word comment artifacts were not removed: %s", normalized)
	}
	if doc.Find("body").Text() != "beforeannotatedafter" {
		t.Fatalf("unexpected normalized text: %s", doc.Find("body").Text())
	}

	luteEngine := util.NewLute()
	luteEngine.SetHTMLTag2TextMark(true)
	tree := luteEngine.HTML2Tree(normalized)
	var inlineMemo *ast.Node
	ast.Walk(tree.Root, func(node *ast.Node, entering bool) ast.WalkStatus {
		if entering && ast.NodeTextMark == node.Type && node.IsTextMarkType("inline-memo") {
			inlineMemo = node
			return ast.WalkStop
		}
		return ast.WalkContinue
	})
	if inlineMemo == nil || inlineMemo.TextMarkTextContent != "annotated" || inlineMemo.TextMarkInlineMemoContent != "memo" {
		t.Fatalf("Word comment was not converted to an inline memo")
	}
}

func TestNormalizeMSWordCommentsFallsBackToText(t *testing.T) {
	dom := `<p>before<a style="mso-comment-reference:TA_2">annotated</a>after</p>`
	normalized := normalizeMSWordComments(dom)

	doc, err := goquery.NewDocumentFromReader(strings.NewReader(normalized))
	if err != nil {
		t.Fatal(err)
	}
	if doc.Find("a").Length() != 0 || doc.Find("body").Text() != "beforeannotatedafter" {
		t.Fatalf("unmatched Word comment did not fall back to text: %s", normalized)
	}
}

func TestNormalizeMSWordCommentsLeavesRegularHTMLUnchanged(t *testing.T) {
	dom := `<p><a href="#target">link</a></p><hr>`
	if normalized := normalizeMSWordComments(dom); normalized != dom {
		t.Fatalf("regular HTML was modified: %s", normalized)
	}
}
