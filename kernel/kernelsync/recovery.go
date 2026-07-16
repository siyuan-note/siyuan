// SiYuan - Refactor your thinking
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package kernelsync

import "time"

// SuperviseRecovery 以有上限的退避持续恢复已经决定的提交。
func SuperviseRecovery(done <-chan struct{}, recover func() error, completed func()) {
	delay := 100 * time.Millisecond
	for {
		select {
		case <-done:
			return
		case <-time.After(delay):
		}
		if err := recover(); err == nil {
			completed()
			return
		}
		if delay < 30*time.Second {
			delay *= 2
			if delay > 30*time.Second {
				delay = 30 * time.Second
			}
		}
	}
}
