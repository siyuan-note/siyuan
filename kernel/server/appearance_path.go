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

package server

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/88250/gulu"
)

// resolveAppearanceFile 在读取前限定真实路径，仅允许主题和图标包目录链接到外部目录。
func resolveAppearanceFile(root, requestPath string) (string, int) {
	relativePath, ok := cleanStaticRelativePath(requestPath)
	if !ok {
		return "", http.StatusForbidden
	}
	root, err := filepath.Abs(root)
	if err != nil {
		return "", http.StatusInternalServerError
	}
	root, err = filepath.EvalSymlinks(root)
	if err != nil {
		return "", http.StatusNotFound
	}
	allowedRoot, target := root, root
	segments := strings.Split(filepath.ToSlash(relativePath), "/")
	for i, segment := range segments {
		target = filepath.Join(target, segment)
		info, statErr := os.Lstat(target)
		if os.IsNotExist(statErr) {
			// 保留缺失主题脚本的空响应和缺失语言包的英文补全行为。
			return filepath.Join(append([]string{target}, segments[i+1:]...)...), 0
		}
		if statErr != nil {
			return "", http.StatusForbidden
		}
		if info.Mode()&os.ModeSymlink != 0 {
			target, err = filepath.EvalSymlinks(target)
			if err != nil {
				return "", http.StatusForbidden
			}
		}
		if i == 1 && (segments[0] == "themes" || segments[0] == "icons") {
			info, err = os.Stat(target)
			if err != nil || !info.IsDir() {
				return "", http.StatusNotFound
			}
			allowedRoot = target
		}
		if target != allowedRoot && !gulu.File.IsSubPath(allowedRoot, target) {
			return "", http.StatusForbidden
		}
	}
	info, err := os.Stat(target)
	if err != nil || !info.Mode().IsRegular() {
		return "", http.StatusNotFound
	}
	return target, 0
}
