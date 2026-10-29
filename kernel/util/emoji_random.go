// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package util

import (
	"math/rand"
	"os"
	"path/filepath"
	"sync"

	"github.com/88250/gulu"
)

// builtinEmojiFallback 是内置 emoji 列表读取失败时的回退码点（书本）。
const builtinEmojiFallback = "1f4d6"

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
		confPath := filepath.Join(AppearancePath, "emojis", "conf.json")
		data, err := os.ReadFile(confPath)
		if err != nil {
			builtinEmojiUnicodes = []string{builtinEmojiFallback}
			return
		}

		var conf []map[string]any
		if err = gulu.JSON.UnmarshalJSON(data, &conf); err != nil {
			builtinEmojiUnicodes = []string{builtinEmojiFallback}
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
			builtinEmojiUnicodes = []string{builtinEmojiFallback}
		}
	})
}

// RandomBuiltinEmoji 返回一个随机的内置 emoji unicode 码点（如 "1f4d6"）。
func RandomBuiltinEmoji() string {
	loadBuiltinEmojiUnicodes()
	return builtinEmojiUnicodes[rand.Intn(len(builtinEmojiUnicodes))]
}
