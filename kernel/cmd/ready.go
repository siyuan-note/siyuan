// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package cmd

// ready 只更新当前连接，刷新和重连后的窗口必须重新报告界面就绪。
type ready struct {
	*BaseCmd
}

func (cmd *ready) Exec() {
	if typ, _ := cmd.session.Get("type"); typ == "main" {
		cmd.session.Set("uiReady", true)
	}
}

func (cmd *ready) Name() string { return "ready" }

func (cmd *ready) IsRead() bool { return true }
