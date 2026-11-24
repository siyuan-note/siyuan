// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"github.com/siyuan-note/siyuan/kernel/util"
)

type notifiedSyncError struct{ error }

func (err notifiedSyncError) Unwrap() error { return err.error }

func pushSyncError(msg string, err error) error {
	if msg == "" {
		return err
	}
	util.PushErrMsg(msg, 0)
	return notifiedSyncError{err}
}

// SyncErrorWasPushed 判断返回给请求方的所有错误是否均已通过 WebSocket 提示。
func SyncErrorWasPushed(err error) bool {
	return allSyncErrorCauses(err, func(cause error) bool {
		_, pushed := cause.(notifiedSyncError)
		return pushed
	})
}

func allSyncErrorCauses(err error, match func(error) bool) bool {
	if match(err) {
		return true
	}
	switch value := err.(type) {
	case interface{ Unwrap() []error }:
		causes := value.Unwrap()
		for _, cause := range causes {
			if !allSyncErrorCauses(cause, match) {
				return false
			}
		}
		return len(causes) > 0
	case interface{ Unwrap() error }:
		return allSyncErrorCauses(value.Unwrap(), match)
	}
	return false
}
