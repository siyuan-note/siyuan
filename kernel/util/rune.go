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
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"unicode"

	"github.com/88250/gulu"
	"github.com/siyuan-note/logging"
)

var newlinesRegex = regexp.MustCompile(`[\r\n]+`)

func ReplaceNewline(text, replaceWith string) string {
	return newlinesRegex.ReplaceAllString(text, replaceWith)
}

func ContainsCJK(text string) bool {
	for _, r := range text {
		ret := unicode.Is(unicode.Han, r) || unicode.Is(unicode.Lm, r) ||
			unicode.Is(unicode.Hiragana, r) || unicode.Is(unicode.Katakana, r) ||
			unicode.Is(unicode.Hangul, r)
		if ret {
			return true
		}
	}
	return false
}

var emojiRegex = regexp.MustCompile(`/([0-9#][\x{20E3}])|` +
	`[\x{00ae}\x{00a9}\x{203C}\x{2047}\x{2048}\x{2049}\x{3030}\x{303D}\x{2139}\x{2122}\x{3297}\x{3299}]|` +
	`[\x{2190}-\x{21FF}]|[\x{FE00}-\x{FEFF}]|` +
	`[\x{2300}-\x{23FF}]|[\x{FE00}-\x{FEFF}]|` +
	`[\x{2460}-\x{24FF}]|[\x{FE00}-\x{FEFF}]|` +
	`[\x{25A0}-\x{25FF}]|[\x{FE00}-\x{FEFF}]|` +
	`[\x{2600}-\x{27BF}]|[\x{FE00}-\x{FEFF}]|` +
	`[\x{2900}-\x{297F}]|[\x{FE00}-\x{FEFF}]|` +
	`[\x{2B00}-\x{2BF0}]|[\x{FE00}-\x{FEFF}]|` +
	`[\x{1F000}-\x{1F6FF}]|[\x{FE00}-\x{FEFF}]|` +
	`[\x{1F600}-\x{1F64F}]|` +
	`[\x{1F680}-\x{1F6FF}]|` +
	`[\x{1F900}-\x{1F9FF}]|` +
	`[\x{1F1E0}-\x{1F1FF}]|` +
	`[\x{1D100}-\x{1D1FF}]|` +
	`[\x{2600}-\x{26FF}]|` +
	`[\x{2700}-\x{27BF}]|` +
	`[\x{10000}-\x{E01EF}]`)

func RemoveEmojiInvisible(text string) (ret string) {
	ret = emojiRegex.ReplaceAllString(text, "")
	ret = RemoveInvalid(ret)
	return
}

func RemoveInvalid(text string) (ret string) {
	ret = gulu.Str.RemoveInvisible(text)
	ret = gulu.Str.RemovePUA(ret)
	return
}

func RemoveInvalidRetainCtrl(text string) (ret string) {
	ret = strings.ReplaceAll(text, "\u00A0", " ") // NBSP 转换为普通空格
	ret = gulu.Str.RemoveZeroWidthNoBreakSpace(ret)
	ret = gulu.Str.RemoveZeroWidthSpace(ret)
	// 不要移除零宽连字符，因为 emoji 需要 https://github.com/siyuan-note/siyuan/issues/14272
	ret = gulu.Str.RemovePUA(ret)
	return
}

var NativeEmojiChars = map[string]bool{}

func InitEmojiChars() {
	builtConfPath := filepath.Join(AppearancePath, "emojis", "conf.json")
	data, err := os.ReadFile(builtConfPath)
	if err != nil {
		logging.LogErrorf("read emojis conf.json failed: %s", err)
		return
	}

	var conf []map[string]interface{}
	if err = gulu.JSON.UnmarshalJSON(data, &conf); err != nil {
		logging.LogErrorf("unmarshal emojis conf.json failed: %s", err)
		return
	}

	for _, emoji := range conf {
		items := emoji["items"].([]interface{})
		for _, item := range items {
			e := item.(map[string]interface{})
			NativeEmojiChars[e["unicode"].(string)] = true
		}
	}
	return
}
