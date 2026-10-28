// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"fmt"
	"path/filepath"

	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// copyExportAppearance 将完整外观包复制到导出目录，并保留默认主题和图标作为后备。
func copyExportAppearance(savePath, theme, icon string) error {
	packages := map[string][]string{
		"themes": {"daylight", "midnight", theme},
		"icons":  {"litheness", icon},
	}
	for kind, names := range packages {
		copied := map[string]bool{}
		for _, name := range names {
			if name == "" || copied[name] {
				continue
			}
			from := util.AppearancePackagePath(kind, name)
			if from == "" {
				return fmt.Errorf("invalid appearance package [%s/%s]", kind, name)
			}
			// 解析包目录本身的符号链接，使导出保留完整资源而不携带本机路径。
			from, err := util.ResolveRealPath(from)
			if err != nil {
				return err
			}
			to := filepath.Join(savePath, "appearance", kind, name)
			if err = filelock.Copy(from, to); err != nil {
				return fmt.Errorf("copy appearance package [%s/%s]: %w", kind, name, err)
			}
			copied[name] = true
		}
	}
	// 离线 HTML 使用与前端声明一致的内置表情字体，不复制用户字体或历史版本。
	fontDir := "Noto-COLRv1-2.051"
	for _, name := range []string{"Noto-COLRv1.woff2", "LICENSE"} {
		from := filepath.Join(util.BuiltInAppearancePath(), "fonts", fontDir, name)
		to := filepath.Join(savePath, "appearance", "fonts", fontDir, name)
		if err := filelock.Copy(from, to); err != nil {
			return fmt.Errorf("copy emoji font [%s]: %w", name, err)
		}
	}
	return nil
}
