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
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// 大纲面板按 HTML 渲染标题块外观样式，样式值必须转义后才能阻止属性逃逸
// https://github.com/siyuan-note/siyuan/security/advisories/GHSA-928g-4hfq-qwvx

func TestRenderOutlineEscapesHeadingStyle(t *testing.T) {
	heading := &ast.Node{Type: ast.NodeHeading, HeadingLevel: 1, ID: "20260101120000-heading"}
	heading.SetIALAttr("style", `"><img src=x onerror=alert(document.domain)>`)
	heading.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("Innocent Heading")})

	html := renderOutline(heading, util.NewLute())
	// 转义后样式值中的尖括号只会以实体形式出现，标签数不会增加
	if 2 != strings.Count(html, "<") {
		t.Fatalf("标题样式逃逸出属性并注入了标签: %s", html)
	}
	if !strings.Contains(html, "&#34;&gt;&lt;img src=x onerror=alert(document.domain)&gt;") {
		t.Fatalf("样式值未按属性值转义: %s", html)
	}
	if !strings.Contains(html, "Innocent&nbsp;Heading") {
		t.Fatalf("大纲 HTML 不符合预期: %s", html)
	}
}

func TestRenderOutlineKeepsHeadingAppearanceStyle(t *testing.T) {
	heading := &ast.Node{Type: ast.NodeHeading, HeadingLevel: 2, ID: "20260101120000-heading"}
	heading.SetIALAttr("style", "color: var(--b3-font-color1);font-size: 32px;")
	heading.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("Title")})

	html := renderOutline(heading, util.NewLute())
	if !strings.Contains(html, "color: var(--b3-font-color1)") {
		t.Fatalf("标题外观样式丢失: %s", html)
	}
	if !strings.Contains(html, "font-size: inherit;") {
		t.Fatalf("大纲字号不应跟随块样式: %s", html)
	}
}

func TestRenderOutlineKeepsQuotedHeadingStyleValue(t *testing.T) {
	heading := &ast.Node{Type: ast.NodeHeading, HeadingLevel: 3, ID: "20260101120000-heading"}
	heading.SetIALAttr("style", `font-family: "Times New Roman";`)
	heading.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("Title")})

	html := renderOutline(heading, util.NewLute())
	if !strings.Contains(html, "font-family: &#34;Times New Roman&#34;;") {
		t.Fatalf("含引号的合法样式应保留为可还原的实体: %s", html)
	}
}
