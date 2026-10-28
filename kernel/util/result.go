// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package util

import (
	"github.com/88250/gulu"
	"github.com/siyuan-note/logging"
)

type PushMode int

const (
	PushModeBroadcast                   PushMode = 0 // 所有应用所有会话广播
	PushModeSingleSelf                  PushMode = 1 // 自我应用会话单播
	PushModeBroadcastExcludeSelf        PushMode = 2 // 非自我会话广播
	PushModeBroadcastExcludeSelfApp     PushMode = 4 // 非自我应用所有会话广播
	PushModeBroadcastApp                PushMode = 5 // 单个应用内所有会话广播
	PushModeBroadcastMainExcludeSelfApp PushMode = 6 // 非自我应用主会话广播
)

type Result struct {
	Cmd       string         `json:"cmd"`
	ReqId     float64        `json:"reqId"`
	AppId     string         `json:"app"`
	SessionId string         `json:"sid"`
	PushMode  PushMode       `json:"pushMode"`
	Callback  any            `json:"callback"`
	Code      int            `json:"code"`
	Msg       string         `json:"msg"`
	Data      any            `json:"data"`
	Context   map[string]any `json:"context,omitempty"`
}

func NewResult() *Result {
	return &Result{Cmd: "",
		ReqId:    0,
		PushMode: 0,
		Callback: "",
		Code:     0,
		Msg:      "",
		Data:     nil}
}

func NewCmdResult(cmdName string, cmdId float64, pushMode PushMode) *Result {
	ret := NewResult()
	ret.Cmd = cmdName
	ret.ReqId = cmdId
	ret.PushMode = pushMode
	return ret
}

func (r *Result) Bytes() []byte {
	ret, err := gulu.JSON.MarshalJSON(r)
	if err != nil {
		logging.LogErrorf("marshal result [%+v] failed [%s]", r, err)
	}
	return ret
}
