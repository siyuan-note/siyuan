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

	"github.com/88250/gulu"
	"github.com/88250/lute/html"
)

func init() {
	rand.Seed(time.Now().UTC().UnixNano())
}

func GetDuplicateName(master string) (ret string) {
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

// InsertElem inserts value at index into a.
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

	ret = strings.ReplaceAll(ret, "&amp;", "__@amp__")
	ret = strings.ReplaceAll(ret, "&#39;", "__@39__")
	ret = strings.ReplaceAll(ret, "&lt;", "__@lt__")
	ret = strings.ReplaceAll(ret, "&gt;", "__@gt__")
	ret = strings.ReplaceAll(ret, "&#34;", "__@34__")
	ret = strings.ReplaceAll(ret, "&#13;", "__@13__")
	ret = html.EscapeString(ret)
	ret = strings.ReplaceAll(ret, "__@amp__", "&amp;")
	ret = strings.ReplaceAll(ret, "__@39__", "&#39;")
	ret = strings.ReplaceAll(ret, "__@lt__", "&lt;")
	ret = strings.ReplaceAll(ret, "__@gt__", "&gt;")
	ret = strings.ReplaceAll(ret, "__@34__", "&#34;")
	ret = strings.ReplaceAll(ret, "__@13__", "&#13;")
	return
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
	s = gulu.Str.RemoveInvisible(s)
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
	if nil != err {
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
