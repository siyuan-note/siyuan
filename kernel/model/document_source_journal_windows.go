// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"errors"
	"time"

	"golang.org/x/sys/windows"
)

func retryDocumentSourceJournalRename(rename func() error) error {
	err := rename()
	for _, delay := range [...]time.Duration{25 * time.Millisecond, 75 * time.Millisecond, 150 * time.Millisecond} {
		// Windows 替换仍被打开的目标文件时可能返回拒绝访问。
		if !errors.Is(err, windows.ERROR_ACCESS_DENIED) && !errors.Is(err, windows.ERROR_SHARING_VIOLATION) &&
			!errors.Is(err, windows.ERROR_LOCK_VIOLATION) {
			return err
		}
		time.Sleep(delay)
		err = rename()
	}
	return err
}
