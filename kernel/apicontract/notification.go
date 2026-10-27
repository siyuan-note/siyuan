// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package apicontract

type NotificationRequest struct {
	Msg     string   `json:"msg" api:"trim"`
	Timeout *float64 `json:"timeout" api:"optional"`
}

type NotificationData struct {
	ID string `json:"id"`
}
