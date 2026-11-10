// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package util

import (
	"os"
	"path/filepath"
	"strings"
)

func loadPlatformFonts() []*Font {
	resolve := func(file string) []*Font {
		path := filepath.Join("/system/fonts", file)
		if strings.EqualFold(filepath.Ext(file), ".ttc") {
			return parseTTCFontFamily(path)
		}
		return parseTTFFontFamily(path)
	}
	// 系统配置格式属于平台实现细节；无法解析时不把字体文件名冒充可用字体族。
	for _, path := range []string{"/system/etc/font_fallback.xml", "/system/etc/fonts.xml"} {
		data, err := os.ReadFile(path)
		if err != nil {
			continue
		}
		if fonts := parseAndroidFontConfig(data, resolve); len(fonts) > 0 {
			return fonts
		}
	}
	return nil
}
