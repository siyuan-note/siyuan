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

func ContainsMarker(str string) (ret string) {
	if !gulu.Str.IsASCII(str) {
		return
	}

	for _, token := range str {
		if IsMarker(byte(token)) {
			return string(token)
		}
	}
	return
}

func IsMarker(token byte) bool {
	switch token {
	case lex.ItemAsterisk, lex.ItemUnderscore, lex.ItemOpenBracket, lex.ItemCloseBracket, lex.ItemNewline,
		lex.ItemBang, lex.ItemBackslash, lex.ItemBacktick, lex.ItemLess, lex.ItemGreater,
		lex.ItemAmpersand, lex.ItemTilde, lex.ItemDollar, lex.ItemOpenBrace, lex.ItemCloseBrace,
		lex.ItemOpenParen, lex.ItemCloseParen, lex.ItemEqual, lex.ItemCrosshatch:
		return true
	case lex.ItemCaret:
		return true
	default:
		return false
	}
}
