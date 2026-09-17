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
	lockPath := filepath.Join(util.DataDir, ".siyuan-appearance")
	filelock.Lock(lockPath)
	defer filelock.Unlock(lockPath)
	runtimeState := newAppearanceRuntimeState()
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
			if (kind == "themes" && !isBuiltInTheme(name)) || (kind == "icons" && !isBuiltInIcon(name)) {
				if err := runtimeState.validate(kind, name); err != nil {
					return err
				}
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
	return nil
}
