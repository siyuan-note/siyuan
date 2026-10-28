// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

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
