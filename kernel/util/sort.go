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
	"io"
	"strings"

	"github.com/facette/natsort"
	"golang.org/x/text/encoding/simplifiedchinese"
	"golang.org/x/text/transform"
)

func NaturalCompare(str1, str2 string) bool {
	str1 = RemoveEmojiInvisible(str1)
	str2 = RemoveEmojiInvisible(str2)
	return natsort.Compare(str1, str2)
}

func EmojiPinYinCompare(str1, str2 string) bool {
	str1_ := strings.TrimSpace(RemoveEmojiInvisible(str1))
	str2_ := strings.TrimSpace(RemoveEmojiInvisible(str2))
	if str1_ == str2_ && 0 == len(str1_) {
		// 全部都是 emoji 的情况按 emoji 字符串排序
		return strings.Compare(str1, str2) < 0
	}
	return PinYinCompare(str1, str2)
}

func PinYinCompare(str1, str2 string) bool {
	str1 = RemoveEmojiInvisible(str1)
	str2 = RemoveEmojiInvisible(str2)

	// Doc tree, backlinks, tags and templates ignores case when sorting alphabetically by name https://github.com/siyuan-note/siyuan/issues/8360
	str1 = strings.ToLower(str1)
	str2 = strings.ToLower(str2)

	a, _ := UTF82GBK(str1)
	b, _ := UTF82GBK(str2)
	bLen := len(b)
	for idx, chr := range a {
		if idx > bLen-1 {
			return false
		}
		if chr != b[idx] {
			return chr < b[idx]
		}
	}
	return true
}

func PinYinCompare4FileTree(str1, str2 string) bool {
	// 文档树字母排序不复用 PinYinCompare 而是单独实现
	// Improve doc tree Name Alphabet sorting https://github.com/siyuan-note/siyuan/issues/14773

	str1 = RemoveEmojiInvisible(str1)
	str1 = strings.TrimSuffix(str1, ".sy")
	str2 = RemoveEmojiInvisible(str2)
	str2 = strings.TrimSuffix(str2, ".sy")

	// Doc tree, backlinks, tags and templates ignores case when sorting alphabetically by name https://github.com/siyuan-note/siyuan/issues/8360
	str1 = strings.ToLower(str1)
	str2 = strings.ToLower(str2)

	a, _ := UTF82GBK(str1)
	b, _ := UTF82GBK(str2)

	// 长度相等的情况下，直接比较字节数组
	if len(a) == len(b) {
		return bytes.Compare(a, b) < 0
	}

	// 长度不相等的情况下，比较前面相等的部分
	if len(a) < len(b) {
		if 0 == bytes.Compare(a, b[:len(a)]) { // 前面相等的情况下短的在前
			return true
		}
		return bytes.Compare(a, b[:len(a)]) < 0
	}
	if 0 == bytes.Compare(a[:len(b)], b) {
		return false
	}
	return bytes.Compare(a[:len(b)], b) < 0
}

// UTF82GBK transform UTF8 rune into GBK byte array.
func UTF82GBK(src string) ([]byte, error) {
	GB18030 := simplifiedchinese.All[0]
	return io.ReadAll(transform.NewReader(bytes.NewReader([]byte(src)), GB18030.NewEncoder()))
}

// GBK2UTF8 transform GBK byte array into UTF8 string.
func GBK2UTF8(src []byte) (string, error) {
	GB18030 := simplifiedchinese.All[0]
	bytes, err := io.ReadAll(transform.NewReader(bytes.NewReader(src), GB18030.NewDecoder()))
	return string(bytes), err
}

const (
	SortModeNameASC         = iota // 0：文件名字母升序
	SortModeNameDESC               // 1：文件名字母降序
	SortModeUpdatedASC             // 2：文件更新时间升序
	SortModeUpdatedDESC            // 3：文件更新时间降序
	SortModeAlphanumASC            // 4：文件名自然数升序
	SortModeAlphanumDESC           // 5：文件名自然数降序
	SortModeCustom                 // 6：自定义排序
	SortModeRefCountASC            // 7：引用数升序
	SortModeRefCountDESC           // 8：引用数降序
	SortModeCreatedASC             // 9：文件创建时间升序
	SortModeCreatedDESC            // 10：文件创建时间降序
	SortModeSizeASC                // 11：文件大小升序
	SortModeSizeDESC               // 12：文件大小降序
	SortModeSubDocCountASC         // 13：子文档数升序
	SortModeSubDocCountDESC        // 14：子文档数降序
	SortModeFileTree               // 15：使用文档树排序规则

	SortModeUnassigned = 256 // 256：未指定排序规则，按照笔记本优先于文档树获取排序规则
)
