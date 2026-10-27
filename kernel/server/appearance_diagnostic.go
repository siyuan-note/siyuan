// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package server

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
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
	for _, path := range slices.Backward(ancestors) {

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
	if errno, ok := errors.AsType[syscall.Errno](err); ok {
		return fmt.Sprintf("%s (errno %d)", err, errno)
	}
	return err.Error()
}
