// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

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
	param       map[string]any
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

func NewCommand(cmdStr string, cmdId float64, param map[string]any, session *melody.Session) (ret Cmd) {
	baseCmd := &BaseCmd{id: cmdId, param: param, session: session}
	switch cmdStr {
	case "closews":
		ret = &closews{baseCmd}
	case "ping":
		ret = &ping{baseCmd}
	case "ready":
		ret = &ready{baseCmd}
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
