// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package cmd

type ping struct {
	*BaseCmd
}

func (cmd *ping) Exec() {
}

func (cmd *ping) Name() string {
	return "ping"
}

func (cmd *ping) IsRead() bool {
	return true
}
