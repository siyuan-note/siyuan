// SiYuan - Refactor your thinking
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

package cmd

import (
	"github.com/olahol/melody"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/util"
)

type Cmd interface {
	Name() string
	IsRead() bool // 非读即写
	Id() float64
	Exec()
}

type BaseCmd struct {
	id          float64
	param       map[string]interface{}
	session     *melody.Session
	PushPayload *util.Result
}

func (cmd *BaseCmd) Id() float64 {
	return cmd.id
}

func (cmd *BaseCmd) Push() {
	cmd.PushPayload.Callback = cmd.param["callback"]
	appId, _ := cmd.session.Get("app")
	cmd.PushPayload.AppId = appId.(string)
	sid, _ := cmd.session.Get("id")
	cmd.PushPayload.SessionId = sid.(string)
	util.PushEvent(cmd.PushPayload)
}

func NewCommand(cmdStr string, cmdId float64, param map[string]interface{}, session *melody.Session) (ret Cmd) {
	baseCmd := &BaseCmd{id: cmdId, param: param, session: session}
	switch cmdStr {
	case "closews":
		ret = &closews{baseCmd}
	case "ping":
		ret = &ping{baseCmd}
	}

	if nil == ret {
		return
	}

	pushMode := util.PushModeSingleSelf
	if pushModeParam := param["pushMode"]; nil != pushModeParam {
		pushMode = util.PushMode(pushModeParam.(float64))
	}
	baseCmd.PushPayload = util.NewCmdResult(ret.Name(), cmdId, pushMode)
	appId, _ := baseCmd.session.Get("app")
	baseCmd.PushPayload.AppId = appId.(string)
	sid, _ := baseCmd.session.Get("id")
	baseCmd.PushPayload.SessionId = sid.(string)
	return
}

func Exec(cmd Cmd) {
	go func() {
		defer logging.Recover()
		cmd.Exec()
	}()
}
