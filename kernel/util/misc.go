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

package util

import (
	"bytes"
	"fmt"
	"math/rand"
	"regexp"
	"strconv"
	"strings"
	"unicode"

	"github.com/88250/lute/html"
	"github.com/microcosm-cc/bluemonday"
	"github.com/siyuan-note/logging"
)

func GetDuplicateName(master string) (ret string) {
	if "" == master {
		return
	}

	ret = master + " (1)"
	r := regexp.MustCompile(`^(.*) \((\d+)\)$`)
	m := r.FindStringSubmatch(master)
	if nil == m || 3 > len(m) {
		return
	}

	num, _ := strconv.Atoi(m[2])
	num++
	ret = fmt.Sprintf("%s (%d)", m[1], num)
	return
}

var (
	letter = []rune("abcdefghijklmnopqrstuvwxyz0123456789")
)

func RandString(length int) string {
	b := make([]rune, length)
	for i := range b {
		b[i] = letter[rand.Intn(len(letter))]
	}
	return string(b)
}

// InsertElem inserts value at index into s.
// 0 <= index <= len(s)
func InsertElem[T any](s []T, index int, value T) []T {
	if len(s) == index { // nil or empty slice or after last element
		return append(s, value)
	}

	s = append(s[:index+1], s[index:]...) // index < len(s)
	s[index] = value
	return s
}

// RemoveElem removes the element at index i from s.
func RemoveElem[T any](s []T, index int) []T {
	return append(s[:index], s[index+1:]...)
}

func EscapeHTML(s string) (ret string) {
	ret = s
	if "" == strings.TrimSpace(ret) {
		return
	}

	ret = html.EscapeString(ret)
	return
}

func UnescapeHTML(s string) (ret string) {
	ret = s
	if "" == strings.TrimSpace(ret) {
		return
	}

	ret = html.UnescapeString(ret)
	return
}

func HasUnclosedHtmlTag(htmlStr string) bool {
	// 检查未闭合注释
	openIdx := 0
	for {
		start := strings.Index(htmlStr[openIdx:], "<!--")
		if start == -1 {
			break
		}
		start += openIdx
		end := strings.Index(htmlStr[start+4:], "-->")
		if end == -1 {
			return true // 存在未闭合注释
		}
		openIdx = start + 4 + end + 3
	}

	// 去除所有注释内容
	commentRe := regexp.MustCompile(`<!--[\s\S]*?-->`)
	htmlStr = commentRe.ReplaceAllString(htmlStr, "")

	tagRe := regexp.MustCompile(`<(/?)([a-zA-Z0-9]+)[^>]*?>`)
	selfClosing := map[string]bool{
		"br": true, "img": true, "hr": true, "input": true, "meta": true, "link": true,
	}
	stack := []string{}
	matches := tagRe.FindAllStringSubmatch(htmlStr, -1)
	for _, m := range matches {
		isClose := m[1] == "/"
		tag := strings.ToLower(m[2])
		if selfClosing[tag] {
			continue
		}
		if !isClose {
			stack = append(stack, tag)
		} else {
			if len(stack) == 0 || stack[len(stack)-1] != tag {
				return true // 闭合标签不匹配
			}
			stack = stack[:len(stack)-1]
		}
	}
	return len(stack) != 0
}

func Reverse(s string) string {
	runes := []rune(s)
	for i, j := 0, len(runes)-1; i < j; i, j = i+1, j-1 {
		runes[i], runes[j] = runes[j], runes[i]
	}
	return string(runes)
}

func RemoveRedundantSpace(str string) string {
	buf := bytes.Buffer{}
	lastIsChinese := false
	lastIsSpace := false
	for _, r := range str {
		if unicode.IsSpace(r) {
			if lastIsChinese || lastIsSpace {
				continue
			}
			buf.WriteRune(' ')
			lastIsChinese = false
			lastIsSpace = true
			continue
		}

		lastIsSpace = false
		buf.WriteRune(r)
		if unicode.Is(unicode.Han, r) {
			lastIsChinese = true
			continue
		} else {
			lastIsChinese = false
		}
	}
	return buf.String()
}

func Convert2Float(s string) (float64, bool) {
	s = RemoveInvalid(s)
	s = strings.ReplaceAll(s, " ", "")
	s = strings.ReplaceAll(s, ",", "")
	buf := bytes.Buffer{}
	for _, r := range s {
		if unicode.IsDigit(r) || '.' == r || '-' == r {
			buf.WriteRune(r)
		}
	}
	s = buf.String()
	ret, err := strconv.ParseFloat(strings.TrimSpace(s), 64)
	if err != nil {
		return 0, false
	}
	return ret, true
}

func ContainsSubStr(s string, subStrs []string) bool {
	for _, v := range subStrs {
		if strings.Contains(s, v) {
			return true
		}
	}
	return false
}

func GetContainsSubStrs(s string, subStrs []string) (ret []string) {
	for _, v := range subStrs {
		if strings.Contains(s, v) {
			ret = append(ret, v)
		}
	}
	return
}

func SanitizeHTML(h string) string {
	p := bluemonday.UGCPolicy()
	return p.Sanitize(h)
}

func SanitizeSVG(svgInput string) string {
	// 1. 将字符串解析为节点树
	doc, err := html.Parse(strings.NewReader(svgInput))
	if err != nil {
		logging.LogWarnf("parse svg failed: %v", err)
		return svgInput
	}

	// 2. 定义递归移除逻辑
	var walk func(*html.Node)
	walk = func(n *html.Node) {
		// 倒序遍历子节点，确保删除操作不影响后续迭代
		for c := n.FirstChild; c != nil; {
			next := c.NextSibling
			if c.Type == html.ElementNode {
				tag := strings.ToLower(c.Data)
				if i := strings.LastIndex(tag, ":"); i >= 0 {
					tag = tag[i+1:]
				}
				if tag == "script" || tag == "iframe" || tag == "object" || tag == "embed" || tag == "foreignobject" || "animate" == tag ||
					"animatetransform" == tag || "animatecolor" == tag || "animatemotion" == tag || "set" == tag {
					n.RemoveChild(c)
					c = next
					continue
				}

				// 清理不安全属性
				if len(c.Attr) > 0 {
					// 过滤属性：删除以 on 开头的属性（事件处理），href/xlink:href 指向 javascript: 或不安全 data:，以及危险的 style 表达式
					filtered := c.Attr[:0]
					for _, a := range c.Attr {
						key := strings.ToLower(a.Key)
						val := strings.TrimSpace(strings.ToLower(a.Val))
						val = strings.Map(func(r rune) rune {
							if r == '\t' || r == '\n' || r == '\r' {
								return -1 // Remove character
							}
							return r
						}, val)

						// 删除事件处理器属性（onload, onerror 等）
						if strings.HasPrefix(key, "on") {
							continue
						}

						if key == "values" || key == "from" || key == "to" {
							// 删除 animate* 元素的 values、from、to 属性以防止恶意动画
							if strings.Contains(val, "javascript:") {
								continue
							}
						}

						// 删除 href 或 xlink:href 指向 javascript: 或某些不安全的 data: URI
						if key == "href" || key == "xlink:href" || key == "xlinkhref" {
							if strings.HasPrefix(val, "javascript:") {
								continue
							}
							// 对 data: 做保守处理，只允许常见安全的图片格式（png/jpeg/gif/webp）
							if strings.HasPrefix(val, "data:") {
								safe := strings.HasPrefix(val, "data:image/png") ||
									strings.HasPrefix(val, "data:image/jpeg") ||
									strings.HasPrefix(val, "data:image/gif") ||
									strings.HasPrefix(val, "data:image/webp")
								if !safe {
									continue
								}
							}
						}

						// 清理 style 中的危险表达式，如 expression() 或 url(javascript:...)
						if key == "style" {
							low := val
							if strings.Contains(low, "expression(") || strings.Contains(low, "url(javascript:") || strings.Contains(low, "javascript:") {
								// 丢弃整个 style 属性以保证安全
								continue
							}
						}

						// 其它属性保留
						filtered = append(filtered, a)
					}
					c.Attr = filtered
				}
			}

			// 递归处理子节点（如果节点尚未被删除）
			if c.Parent != nil {
				walk(c)
			}

			c = next
		}
	}

	// 3. 执行移除
	walk(doc)

	// 4. 将处理后的树重新渲染回字符串
	var buf bytes.Buffer
	if err = html.Render(&buf, doc); err != nil {
		logging.LogWarnf("render svg failed: %v", err)
		return svgInput
	}

	// 5. 提取 SVG 部分 (html.Render 会自动加上 <html><body> 标签)
	return extractSVG(buf.String())
}

func extractSVG(fullHTML string) string {
	start := strings.Index(fullHTML, "<svg")
	end := strings.LastIndex(fullHTML, "</svg>")
	if start == -1 || end == -1 {
		return fullHTML
	}
	return fullHTML[start : end+6]
}
