// SiYuan - From thought to insight, with agents
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
			from, err := filepath.EvalSymlinks(from)
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
