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
	"strconv"
	"strings"

	"github.com/88250/lute/parse"
	"github.com/PuerkitoBio/goquery"
	nethtml "golang.org/x/net/html"
)

var clipboardTextStyleProperties = map[string]bool{
	"background":           true,
	"background-color":     true,
	"color":                true,
	"font":                 true,
	"font-family":          true,
	"font-size":            true,
	"font-style":           true,
	"font-weight":          true,
	"text-decoration":      true,
	"text-decoration-line": true,
}

// matchHTMLClipboardElements 保留 HTML 元素及基本强调，移除由来源应用决定的文字外观。
func matchHTMLClipboardElements(dom string) string {
	lower := strings.ToLower(dom)
	if !strings.Contains(lower, "style") && !strings.Contains(lower, "<font") {
		return dom
	}
	doc, err := goquery.NewDocumentFromReader(strings.NewReader(dom))
	if err != nil {
		return dom
	}
	preserveClipboardCSSSemantics(doc.Find("body").Get(0))
	doc.Find("[style]").Each(func(_ int, selection *goquery.Selection) {
		style, _ := selection.Attr("style")
		style = filterClipboardStyle(style, clipboardTextStyleProperties)
		if strings.TrimSpace(style) == "" {
			selection.RemoveAttr("style")
		} else {
			selection.SetAttr("style", style)
		}
	})
	// font 的外观属性与对应 CSS 属性采用相同的匹配规则。
	doc.Find("font").RemoveAttr("color").RemoveAttr("face").RemoveAttr("size")
	ret, err := doc.Find("body").Html()
	if err != nil {
		return dom
	}
	return ret
}

func preserveClipboardCSSSemantics(root *nethtml.Node) {
	if root == nil {
		return
	}
	var texts []*nethtml.Node
	var collect func(*nethtml.Node)
	collect = func(n *nethtml.Node) {
		if n.Type == nethtml.TextNode && strings.TrimSpace(n.Data) != "" {
			texts = append(texts, n)
		}
		for child := n.FirstChild; child != nil; child = child.NextSibling {
			collect(child)
		}
	}
	collect(root)
	for _, text := range texts {
		weight, fontStyle := "", ""
		underline, strike := false, false
		strongTag, emTag, underlineTag, strikeTag, ignored := false, false, false, false, false
		for n := text.Parent; n != nil; n = n.Parent {
			switch n.Data {
			case "script", "style":
				ignored = true
			case "strong", "b":
				strongTag = true
			case "em", "i":
				emTag = true
			case "u":
				underlineTag = true
			case "s", "del", "strike":
				strikeTag = true
			}
			decl := parse.HTMLStyleDeclarations(clipboardNodeStyle(n))
			font := strings.ToLower(decl["font"])
			if weight == "" {
				weight = strings.ToLower(decl["font-weight"])
				if weight == "" && font != "" {
					weight = font
				}
			}
			if fontStyle == "" {
				fontStyle = strings.ToLower(decl["font-style"])
				if fontStyle == "" && font != "" {
					fontStyle = font
				}
			}
			decoration := strings.ToLower(decl["text-decoration"] + " " + decl["text-decoration-line"])
			underline = underline || n.Data != "a" && strings.Contains(decoration, "underline")
			strike = strike || strings.Contains(decoration, "line-through")
		}
		if ignored {
			continue
		}
		var tags []string
		if !strongTag && isClipboardCSSBold(weight) {
			tags = append(tags, "strong")
		}
		if !emTag && (strings.Contains(fontStyle, "italic") || strings.Contains(fontStyle, "oblique")) {
			tags = append(tags, "em")
		}
		if !underlineTag && underline {
			tags = append(tags, "u")
		}
		if !strikeTag && strike {
			tags = append(tags, "s")
		}
		wrapClipboardTextNode(text, tags)
	}
}

func isClipboardCSSBold(value string) bool {
	for _, word := range strings.FieldsFunc(value, func(r rune) bool {
		return r == ' ' || r == '/' || r == ','
	}) {
		if word == "bold" || word == "bolder" {
			return true
		}
		weight, err := strconv.Atoi(word)
		if err == nil && weight >= 600 && weight <= 1000 {
			return true
		}
	}
	return false
}

func wrapClipboardTextNode(text *nethtml.Node, tags []string) {
	if len(tags) == 0 || text.Parent == nil {
		return
	}
	parent, next := text.Parent, text.NextSibling
	parent.RemoveChild(text)
	var wrapped = text
	for _, tag := range tags {
		wrapper := &nethtml.Node{Type: nethtml.ElementNode, Data: tag}
		wrapper.AppendChild(wrapped)
		wrapped = wrapper
	}
	if next == nil {
		parent.AppendChild(wrapped)
	} else {
		parent.InsertBefore(wrapped, next)
	}
}

func clipboardNodeStyle(n *nethtml.Node) string {
	for _, attr := range n.Attr {
		if attr.Key == "style" {
			return attr.Val
		}
	}
	return ""
}

// filterClipboardStyle 仅移除目标声明，原样保留其他声明的优先级、引号和函数内容。
func filterClipboardStyle(style string, remove map[string]bool) string {
	var ret strings.Builder
	start, depth := 0, 0
	var quote rune
	escaped := false
	style += ";"
	for i, c := range style {
		if escaped {
			escaped = false
			continue
		}
		if c == '\\' {
			escaped = true
			continue
		}
		if quote != 0 {
			if c == quote {
				quote = 0
			}
			continue
		}
		if c == '\'' || c == '"' {
			quote = c
			continue
		}
		if c == '(' {
			depth++
		} else if c == ')' {
			depth--
		}
		if c != ';' || depth != 0 {
			continue
		}
		part := style[start : i+1]
		start = i + 1
		decl := parse.HTMLStyleDeclarations(part)
		keep := true
		for key := range decl {
			if remove[key] {
				keep = false
			}
		}
		if keep && strings.TrimSpace(part) != ";" {
			ret.WriteString(part)
		}
	}
	if start < len(style)-1 {
		ret.WriteString(style[start : len(style)-1])
	}
	return ret.String()
}
