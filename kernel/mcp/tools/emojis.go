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

package tools

import (
	"math/rand"
	"os"
	"path/filepath"
	"sync"

	"github.com/88250/gulu"

	"github.com/siyuan-note/siyuan/kernel/util"
)

// builtinEmojiUnicodes 缓存内置 emoji 的全部 unicode 码点（来自 appearance/emojis/conf.json）。
// 与前端 getRandomEmoji() 数据源一致，但刻意排除用户自定义图片，
// 保持随机图标风格统一、避免误用用户的重要图片。
var (
	builtinEmojiUnicodes     []string
	builtinEmojiUnicodesOnce sync.Once
)

// loadBuiltinEmojiUnicodes 懒加载内置 emoji 的 unicode 列表。
// 失败时回退到一个固定码点，调用方始终拿到可用值。
func loadBuiltinEmojiUnicodes() {
	builtinEmojiUnicodesOnce.Do(func() {
		confPath := filepath.Join(util.AppearancePath, "emojis", "conf.json")
		data, err := os.ReadFile(confPath)
		if err != nil {
			builtinEmojiUnicodes = []string{"1f4d6"}
			return
		}

		var conf []map[string]any
		if err = gulu.JSON.UnmarshalJSON(data, &conf); err != nil {
			builtinEmojiUnicodes = []string{"1f4d6"}
			return
		}

		for _, category := range conf {
			items, ok := category["items"].([]any)
			if !ok {
				continue
			}
			for _, item := range items {
				e, ok := item.(map[string]any)
				if !ok {
					continue
				}
				if u, ok := e["unicode"].(string); ok && u != "" {
					builtinEmojiUnicodes = append(builtinEmojiUnicodes, u)
				}
			}
		}

		if len(builtinEmojiUnicodes) == 0 {
			builtinEmojiUnicodes = []string{"1f4d6"}
		}
	})
}

// randomEmoji 返回一个随机的内置 emoji unicode 码点（如 "1f4d6"）。
func randomEmoji() string {
	loadBuiltinEmojiUnicodes()
	return builtinEmojiUnicodes[rand.Intn(len(builtinEmojiUnicodes))]
}
