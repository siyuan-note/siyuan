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
	"time"
	"unicode"

	"github.com/88250/lute/html"
	"github.com/siyuan-note/logging"
)

func init() {
	rand.Seed(time.Now().UTC().UnixNano())
}

func GetDuplicateName(master string) (ret string) {
	if "" == master {
		return
	}

	ret = master + " (1)"
	r := regexp.MustCompile("^(.*) \\((\\d+)\\)$")
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

func ReplaceStr(strs []string, old, new string) (ret []string, changed bool) {
	if old == new {
		return strs, false
	}

	for i, v := range strs {
		if v == old {
			strs[i] = new
			changed = true
		}
	}
	ret = strs
	return
}

// RemoveScriptsInSVG 移除 SVG 中的 <script> 标签及其内部所有内容
func RemoveScriptsInSVG(svgInput string) string {
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
			// 检查标签名是否为 script
			if c.Type == html.ElementNode && strings.EqualFold(c.Data, "script") {
				n.RemoveChild(c)
			} else {
				// 递归处理子节点
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
