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

package search

import (
	"regexp"
	"slices"
	"strings"
)

// hanSimpToTrads 是 hanTradToSimp 的反向索引：简体字 -> 折叠到该简体的全部繁体字。
var hanSimpToTrads = map[rune][]rune{}

func init() {
	for t, s := range hanTradToSimp {
		hanSimpToTrads[s] = append(hanSimpToTrads[s], t)
	}
	for _, ts := range hanSimpToTrads {
		slices.Sort(ts)
	}
}

// hanCharClass 返回与 r 繁简等价的所有字符（含 r 自身对应的简体），用于构造高亮正则。
func hanCharClass(r rune) (ret []rune) {
	canon := r
	if s, ok := hanTradToSimp[r]; ok {
		canon = s
	}
	ret = append(ret, canon)
	ret = append(ret, hanSimpToTrads[canon]...)
	return
}

// hanInsensitiveRegexp 将关键字逐字符展开为繁简等价字符类，例如 "诗经" -> "[诗詩][经經]"。
// 仅用于搜索结果高亮；等价关系与 go-sqlite3 中 siyuan 分词器 han_insensitive 的映射表
// 来自同一份 OpenCC TSCharacters 数据，必须保持一致。
func hanInsensitiveRegexp(k string) string {
	var b strings.Builder
	for _, r := range k {
		class := hanCharClass(r)
		if 1 == len(class) {
			b.WriteString(regexp.QuoteMeta(string(r)))
			continue
		}
		b.WriteString("[")
		for _, c := range class {
			b.WriteString(regexp.QuoteMeta(string(c)))
		}
		b.WriteString("]")
	}
	return b.String()
}
