// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build !linux && !darwin && !windows

package model

import "os"

// templateHTTPFileProof 无可靠平台身份时只允许本次执行确认。
func templateHTTPFileProof(_ *os.File) (string, bool, error) {
	return "", false, nil
}
