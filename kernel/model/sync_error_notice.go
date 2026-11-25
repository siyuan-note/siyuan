// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"github.com/siyuan-note/siyuan/kernel/util"
)

type SyncErrorNotice struct {
	ID, Message        string
	Code, CloseTimeout int
}

type notifiedSyncError struct {
	error
	notice SyncErrorNotice
}

func (err notifiedSyncError) Unwrap() error { return err.error }

func pushSyncNotice(msg string, code, closeTimeout int) SyncErrorNotice {
	notice := SyncErrorNotice{
		ID: "sync-notice-" + util.RandString(16), Message: msg, Code: code, CloseTimeout: closeTimeout,
	}
	util.BroadcastByType("main", "msg", code, msg, map[string]any{"id": notice.ID, "closeTimeout": closeTimeout})
	return notice
}

func pushSyncError(msg string, err error) error {
	if msg == "" {
		return err
	}
	return notifiedSyncError{err, pushSyncNotice(msg, -1, 0)}
}

// SyncErrorNoticeFor 只有一条通知覆盖整个错误时，HTTP 和 WebSocket 才共用该通知。
func SyncErrorNoticeFor(err error) (notice SyncErrorNotice, pushed bool) {
	sameID := true
	pushed = allSyncErrorCauses(err, func(cause error) bool {
		notified, ok := cause.(notifiedSyncError)
		if !ok {
			return false
		}
		if notice.ID == "" {
			notice = notified.notice
		} else if notice.ID != notified.notice.ID {
			sameID = false
		}
		return true
	})
	if !pushed || !sameID {
		notice = SyncErrorNotice{}
	}
	return
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
