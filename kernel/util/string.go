// SiYuan - Build Your Eternal Digital Garden
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
	"strings"
	"unicode"
)

func RemoveInvisible(str string) string {
	str = strings.ReplaceAll(str, "\u00A0", " ") // NBSP 转换为普通空格
	str = RemoveZeroWidthCharacters(str)
	str = stripCtlFromUTF8(str)
	return str
}

func stripCtlFromUTF8(str string) string {
	return strings.Map(func(r rune) rune {
		if r >= 32 && r != 127 {
			return r
		}
		return -1
	}, str)
}

const (
	// ZWSP represents zero-width space.
	ZWSP = '\u200B'

	// ZWNBSP represents zero-width no-break space.
	ZWNBSP = '\uFEFF'

	// ZWJ represents zero-width joiner.
	ZWJ = '\u200D'

	// ZWNJ represents zero-width non-joiner.
	ZWNJ = '\u200C'

	empty = ""
)

var replacer = strings.NewReplacer(string(ZWSP), empty,
	string(ZWNBSP), empty,
	string(ZWJ), empty,
	string(ZWNJ), empty)

// HasZeroWidthCharacters reports whether string s contains zero-width characters.
func HasZeroWidthCharacters(s string) bool {
	return strings.ContainsRune(s, ZWSP) ||
		strings.ContainsRune(s, ZWNBSP) ||
		strings.ContainsRune(s, ZWJ) ||
		strings.ContainsRune(s, ZWNJ)
}

// RemoveZeroWidthCharacters removes all zero-width characters from string s.
func RemoveZeroWidthCharacters(s string) string {
	return replacer.Replace(s)
}

// RemoveZeroWidthSpace removes zero-width space characters from string s.
func RemoveZeroWidthSpace(s string) string {
	return strings.Replace(s, string(ZWSP), empty, -1)
}

// RemoveZeroWidthNoBreakSpace removes zero-width no-break space characters from string s.
func RemoveZeroWidthNoBreakSpace(s string) string {
	return strings.Replace(s, string(ZWNBSP), empty, -1)
}

// RemoveZeroWidthJoiner removes zero-width joiner characters from string s.
func RemoveZeroWidthJoiner(s string) string {
	return strings.Replace(s, string(ZWJ), empty, -1)
}

// RemoveZeroWidthNonJoiner removes zero-width non-joiner characters from string s.
func RemoveZeroWidthNonJoiner(s string) string {
	return strings.Replace(s, string(ZWNJ), empty, -1)
}

func IsASCII(s string) bool {
	for i := 0; i < len(s); i++ {
		if s[i] > unicode.MaxASCII {
			return false
		}
	}
	return true
}

func SubstringsBetween(str, start, end string) (ret []string) {
	parts := strings.Split(str, start)
	for _, p := range parts {
		if !strings.Contains(p, end) {
			continue
		}
		parts2 := strings.Split(p, end)
		ret = append(ret, parts2[0])
	}
	return
}
