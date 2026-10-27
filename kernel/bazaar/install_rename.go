// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package bazaar

import (
	"os"
	"time"
)

func renamePackageDirectory(source, target string) error {
	return renamePackageDirectoryWithRetry(source, target, os.Rename)
}

// renamePackageDirectoryWithRetry 对 Windows 的目录占用错误最多尝试三次。
// 重试间隔为 200 毫秒，提交前的版本、取消与授权复核由 rename 回调执行。
func renamePackageDirectoryWithRetry(source, target string, rename func(string, string) error) (err error) {
	for attempt := 0; attempt < 3; attempt++ {
		err = rename(source, target)
		if !isPackageRenameBusy(err) || attempt == 2 {
			return err
		}
		time.Sleep(200 * time.Millisecond)
	}
	return err
}
