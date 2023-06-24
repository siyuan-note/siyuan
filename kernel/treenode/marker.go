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

package treenode

import (
	"github.com/88250/gulu"
	"github.com/88250/lute/lex"
)

func ContainsMarker(str string) bool {
	if !gulu.Str.IsASCII(str) {
		return false
	}

	for _, token := range str {
		if IsMarker(byte(token)) {
			return true
		}
	}
	return false
}

func IsMarker(token byte) bool {
	switch token {
	case lex.ItemAsterisk, lex.ItemUnderscore, lex.ItemOpenBracket, lex.ItemBang, lex.ItemNewline, lex.ItemBackslash, lex.ItemBacktick, lex.ItemLess,
		lex.ItemCloseBracket, lex.ItemAmpersand, lex.ItemTilde, lex.ItemDollar, lex.ItemOpenBrace, lex.ItemOpenParen, lex.ItemEqual, lex.ItemCrosshatch:
		return true
	case lex.ItemCaret:
		return true
	default:
		return false
	}
}
