// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"errors"

	"github.com/siyuan-note/siyuan/kernel/util"
)

// AcquirePluginRPCWrite 为实际 RPC 方法（含异步通知）取得工作空间写入准入租约。
// 在插件事件循环上只尝试加锁，不等待导入提交，避免阻塞事件循环中的其他回调。
// 调用者必须在方法真正结束后释放；HTTP 等待者取消不能提前释放仍在执行的方法。
func AcquirePluginRPCWrite() (release func(), err error) {
	if util.ReadOnly {
		return nil, errors.New(Conf.Language(34))
	}
	if !dataImportAccess.TryRLock() {
		if IsSyncCheckoutApplying() {
			return nil, errors.New(Conf.Language(436))
		}
		return nil, errors.New(Conf.Language(239))
	}
	if err = checkDataImportRecovery(); err != nil {
		dataImportAccess.RUnlock()
		return nil, err
	}
	return dataImportAccess.RUnlock, nil
}
