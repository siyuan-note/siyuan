// SiYuan - Refactor your thinking
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package synccommit

import (
	"sync/atomic"

	"github.com/siyuan-note/siyuan/kernel/model"
)

var recoveryReady atomic.Bool

var defaultEngine = NewEngine(Options{
	Reload: model.ReloadFiletree,
	Advance: func() uint64 {
		model.IncSync()
		return model.WorkspaceGeneration()
	},
})

// SetRecoveryPending 在启动恢复开始前关闭 kernel sync 就绪状态。
func SetRecoveryPending() { recoveryReady.Store(false) }

// Ready 报告默认提交引擎是否已经成功完成启动恢复。
func Ready() bool { return recoveryReady.Load() }

func Recover() error {
	SetRecoveryPending()
	if err := defaultEngine.RecoverAll(); err != nil {
		return err
	}
	recoveryReady.Store(true)
	return nil
}
