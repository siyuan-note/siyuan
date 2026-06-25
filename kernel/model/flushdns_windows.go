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
