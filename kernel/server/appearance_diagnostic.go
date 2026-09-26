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
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"syscall"

	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var diagnosedAppearanceRoots sync.Map

// logAppearanceRootDiagnostic 在启动完成后记录一次各级路径的访问结果，定位根目录解析失败的位置。
func logAppearanceRootDiagnostic(root, target string) {
	if !util.IsBooted() {
		return
	}
	if _, loaded := diagnosedAppearanceRoots.LoadOrStore(root, struct{}{}); loaded {
		return
	}

	var ancestors []string
	for current := root; ; current = filepath.Dir(current) {
		ancestors = append(ancestors, current)
		if parent := filepath.Dir(current); parent == current {
			break
		}
	}
	for i := len(ancestors) - 1; i >= 0; i-- {
		path := ancestors[i]
		_, lstatErr := os.Lstat(path)
		_, statErr := os.Stat(path)
		resolved, resolveErr := evalAppearanceSymlinks(path)
		logging.LogWarnf("appearance path diagnostic [%s]: lstat [%s], stat [%s], resolve [%s] [%s]",
			path, appearanceDiagnosticError(lstatErr), appearanceDiagnosticError(statErr),
			resolved, appearanceDiagnosticError(resolveErr))
	}
	for _, path := range []string{root, target} {
		file, err := os.Open(path)
		if err == nil {
			err = file.Close()
		}
		logging.LogWarnf("appearance path diagnostic [%s]: open [%s]", path, appearanceDiagnosticError(err))
	}
}

func appearanceDiagnosticError(err error) string {
	if err == nil {
		return "ok"
	}
	var errno syscall.Errno
	if errors.As(err, &errno) {
		return fmt.Sprintf("%s (errno %d)", err, errno)
	}
	return err.Error()
}
