// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build windows

package model

import (
	"os/exec"

	"github.com/88250/gulu"
	"github.com/siyuan-note/logging"
)

// flushDNS 刷新 Windows 系统 DNS 解析缓存，用于在同步遇到 DNS 类错误（域名解析失败、过期缓存）后
// 清掉本地可能过期的解析记录，以便后续重试时能重新向上游 DNS 查询。
func flushDNS() {
	cmd := exec.Command("ipconfig", "/flushdns")
	gulu.CmdAttr(cmd)
	output, err := cmd.CombinedOutput()
	if nil != err {
		logging.LogErrorf("flush DNS cache failed: %s", err)
		return
	}
	logging.LogInfof("flushed DNS cache: %s", gulu.DecodeCmdOutput(output))
}
