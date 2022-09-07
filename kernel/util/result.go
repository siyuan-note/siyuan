// SiYuan - Build Your Eternal Digital Garden
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

package util

import (
	"github.com/88250/gulu"
	"github.com/siyuan-note/logging"
)

type PushMode int

const (
	PushModeBroadcast               PushMode = 0  // 广播
	PushModeSingleSelf              PushMode = 1  // 自我单播
	PushModeBroadcastExcludeSelf    PushMode = 2  // 非自我广播
	PushModeBroadcastExcludeSelfApp PushMode = 4  // 非自我应用广播
	PushModeNone                    PushMode = 10 // 不进行 reload
)

type Result struct {
	Cmd            string      `json:"cmd"`
	ReqId          float64     `json:"reqId"`
	AppId          string      `json:"app"`
	SessionId      string      `json:"sid"`
	PushMode       PushMode    `json:"pushMode"`
	ReloadPushMode PushMode    `json:"reloadPushMode"`
	Callback       interface{} `json:"callback"`
	Code           int         `json:"code"`
	Msg            string      `json:"msg"`
	Data           interface{} `json:"data"`
}

func NewResult() *Result {
	return &Result{Cmd: "",
		ReqId:          0,
		PushMode:       0,
		ReloadPushMode: 0,
		Callback:       "",
		Code:           0,
		Msg:            "",
		Data:           nil}
}

func NewCmdResult(cmdName string, cmdId float64, pushMode, reloadPushMode PushMode) *Result {
	ret := NewResult()
	ret.Cmd = cmdName
	ret.ReqId = cmdId
	ret.PushMode = pushMode
	ret.ReloadPushMode = reloadPushMode
	return ret
}

func (r *Result) Bytes() []byte {
	ret, err := gulu.JSON.MarshalJSON(r)
	if nil != err {
		logging.LogErrorf("marshal result [%+v] failed [%s]", r, err)
	}
	return ret
}
