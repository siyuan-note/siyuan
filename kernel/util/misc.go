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
	"encoding/json"
	"encoding/xml"
	"fmt"
	"io"
	"math/rand"
	"reflect"
	"regexp"
	"strconv"
	"strings"
	"unicode"

	"github.com/88250/lute/html"
	"github.com/microcosm-cc/bluemonday"
)

// Optional is a generic type that represents an optional value, which can be in one of three states:
//   - not set (Exists=false)
//   - set to a non-null value (Exists=true, IsNull=false)
//   - explicitly set to null (Exists=true, IsNull=true).
//
// This allows distinguishing between "not provided" and "explicitly null" when unmarshaling JSON.
type Optional[T any] struct {
	Value  T
	Exists bool
	IsNull bool
}

func (o Optional[T]) IsZero() bool { return !o.Exists }

func (o Optional[T]) IsNullValue() bool { return o.Exists && o.IsNull }

func (o Optional[T]) HasValue() bool { return o.Exists && !o.IsNull }

func (o *Optional[T]) UnmarshalJSON(data []byte) error {
	o.Exists = true
	if string(data) == "null" {
		o.IsNull = true
		return nil
	}
	o.IsNull = false
	return json.Unmarshal(data, &o.Value)
}

func (o Optional[T]) MarshalJSON() ([]byte, error) {
	if !o.Exists || o.IsNull {
		return []byte("null"), nil
	}
	return json.Marshal(o.Value)
}

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

// CountIf 统计数字列表中满足指定比较条件的元素个数。
// op 为比较操作符："gt"/"lt"/"eq"/"ge"/"le"，threshold 为比较阈值。
// 例如 CountIf(values, "gt", 0) 统计大于 0 的个数。非数字元素按 0 处理。
func CountIf(list any, op string, threshold any) int {
	thresholdF, ok := ToFloat64(threshold)
	if !ok {
		return 0
	}
	count := 0
	v := reflect.ValueOf(list)
	if v.Kind() != reflect.Slice && v.Kind() != reflect.Array {
		return 0
	}
	for i := 0; i < v.Len(); i++ {
		elem, ok := ToFloat64(v.Index(i).Interface())
		if !ok {
			continue
		}
		switch op {
		case "gt":
			if elem > thresholdF {
				count++
			}
		case "lt":
			if elem < thresholdF {
				count++
			}
		case "eq":
			if elem == thresholdF {
				count++
			}
		case "ge":
			if elem >= thresholdF {
				count++
			}
		case "le":
			if elem <= thresholdF {
				count++
			}
		}
	}
	return count
}

// ToFloat64 将常用数值/字符串类型转换为 float64。
func ToFloat64(v any) (float64, bool) {
	switch x := v.(type) {
	case float64:
		return x, true
	case float32:
		return float64(x), true
	case int:
		return float64(x), true
	case int64:
		return float64(x), true
	case string:
		f, err := strconv.ParseFloat(strings.TrimSpace(x), 64)
		return f, err == nil
	}
	return 0, false
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

const (
	maxSVGDepth  = 256
	maxSVGTokens = 1_000_000
)

var unsafeSVGElements = map[string]struct{}{
	"script":           {},
	"iframe":           {},
	"object":           {},
	"embed":            {},
	"foreignobject":    {},
	"animate":          {},
	"animatetransform": {},
	"animatecolor":     {},
	"animatemotion":    {},
	"set":              {},
}

// SanitizeSVG 使用 XML 语义过滤 SVG，避免 HTML 与 XML 解析规则差异导致活动内容绕过过滤。
func SanitizeSVG(svgInput string) (string, error) {
	decoder := xml.NewDecoder(strings.NewReader(svgInput))
	decoder.Strict = true

	var buf bytes.Buffer
	encoder := xml.NewEncoder(&buf)
	rootSeen := false
	rootClosed := false
	depth := 0
	skipDepth := 0
	tokenCount := 0
	var elementStack []xml.Name

	for {
		token, err := decoder.RawToken()
		if err == io.EOF {
			break
		}
		if err != nil {
			return "", fmt.Errorf("parse svg failed: %w", err)
		}
		tokenCount++
		if tokenCount > maxSVGTokens {
			return "", fmt.Errorf("svg contains too many tokens")
		}

		switch typed := token.(type) {
		case xml.StartElement:
			elementStack = append(elementStack, typed.Name)
			depth++
			if depth > maxSVGDepth {
				return "", fmt.Errorf("svg nesting depth exceeds %d", maxSVGDepth)
			}
			if rootClosed {
				return "", fmt.Errorf("svg contains multiple root elements")
			}
			if !rootSeen {
				if !strings.EqualFold(typed.Name.Local, "svg") {
					return "", fmt.Errorf("root element is not svg")
				}
				rootSeen = true
			}

			if skipDepth > 0 {
				skipDepth++
				continue
			}
			if _, unsafe := unsafeSVGElements[strings.ToLower(typed.Name.Local)]; unsafe {
				skipDepth = 1
				continue
			}

			typed.Name = preserveXMLName(typed.Name)
			typed.Attr = sanitizeSVGAttributes(typed.Attr)
			if err = encoder.EncodeToken(typed); err != nil {
				return "", fmt.Errorf("render svg failed: %w", err)
			}
		case xml.EndElement:
			if depth <= 0 || len(elementStack) == 0 {
				return "", fmt.Errorf("svg contains an unexpected closing element")
			}
			startName := elementStack[len(elementStack)-1]
			if startName != typed.Name {
				return "", fmt.Errorf("svg closing element %q does not match %q", typed.Name.Local, startName.Local)
			}
			elementStack = elementStack[:len(elementStack)-1]
			if skipDepth > 0 {
				skipDepth--
				depth--
				if depth == 0 {
					rootClosed = true
				}
				continue
			}
			typed.Name = preserveXMLName(typed.Name)
			if err = encoder.EncodeToken(typed); err != nil {
				return "", fmt.Errorf("render svg failed: %w", err)
			}
			depth--
			if depth == 0 {
				rootClosed = true
			}
		case xml.CharData:
			if skipDepth > 0 {
				continue
			}
			if (!rootSeen || rootClosed) && strings.TrimSpace(string(typed)) != "" {
				return "", fmt.Errorf("svg contains text outside the root element")
			}
			if rootSeen && !rootClosed {
				if err = encoder.EncodeToken(typed); err != nil {
					return "", fmt.Errorf("render svg failed: %w", err)
				}
			}
		case xml.Comment:
			if skipDepth == 0 && rootSeen && !rootClosed {
				if err = encoder.EncodeToken(typed); err != nil {
					return "", fmt.Errorf("render svg failed: %w", err)
				}
			}
		case xml.Directive:
			return "", fmt.Errorf("svg directives are not allowed")
		case xml.ProcInst:
			// XML 声明和处理指令不影响 SVG 图像内容，输出时统一省略。
		}
	}

	if !rootSeen || !rootClosed || depth != 0 || skipDepth != 0 || len(elementStack) != 0 {
		return "", fmt.Errorf("svg root element is incomplete")
	}
	if err := encoder.Close(); err != nil {
		return "", fmt.Errorf("render svg failed: %w", err)
	}
	return buf.String(), nil
}

func preserveXMLName(name xml.Name) xml.Name {
	if name.Space != "" {
		name.Local = name.Space + ":" + name.Local
		name.Space = ""
	}
	return name
}

func sanitizeSVGAttributes(attrs []xml.Attr) []xml.Attr {
	filtered := make([]xml.Attr, 0, len(attrs))
	for _, attr := range attrs {
		key := strings.ToLower(attr.Name.Local)
		value := normalizeSVGAttributeValue(attr.Value)
		if strings.HasPrefix(key, "on") {
			continue
		}
		if key == "href" {
			if strings.HasPrefix(value, "javascript:") || strings.HasPrefix(value, "vbscript:") {
				continue
			}
			if strings.HasPrefix(value, "data:") && !isSafeSVGDataImage(value) {
				continue
			}
		}
		if key == "style" && (strings.Contains(value, "expression(") || strings.Contains(value, "javascript:") ||
			strings.Contains(value, "vbscript:")) {
			continue
		}
		attr.Name = preserveXMLName(attr.Name)
		filtered = append(filtered, attr)
	}
	return filtered
}

func normalizeSVGAttributeValue(value string) string {
	return strings.ToLower(strings.Map(func(r rune) rune {
		if unicode.IsSpace(r) || unicode.IsControl(r) {
			return -1
		}
		return r
	}, strings.TrimSpace(value)))
}

func isSafeSVGDataImage(value string) bool {
	return strings.HasPrefix(value, "data:image/png") ||
		strings.HasPrefix(value, "data:image/jpeg") ||
		strings.HasPrefix(value, "data:image/gif") ||
		strings.HasPrefix(value, "data:image/webp")
}

var nonAlphanumericRegexp = regexp.MustCompile(`[^0-9a-zA-Z]`)

// SanitizeName replaces all non-alphanumeric characters in the input string with underscores.
func SanitizeName(name string) string {
	return nonAlphanumericRegexp.ReplaceAllString(name, "_")
}
