// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"context"
	"errors"
	"sync"
	"time"

	"github.com/siyuan-note/siyuan/kernel/memo"
	"github.com/siyuan-note/siyuan/kernel/util"
)

const aiMemoryCandidateRetention = 30 * 24 * time.Hour

var aiMemoryCandidateMaintenance sync.Mutex

// AIMemoryCandidatesJob 在统一定时任务中执行，无需额外模型调用，桌面与移动端共用。
func AIMemoryCandidatesJob() {
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	if err := maintainAIMemoryCandidates(ctx, time.Now()); err != nil {
		recordAIMemoryFailure("candidate-cleanup", err)
	}
}

func maintainAIMemoryCandidates(ctx context.Context, now time.Time) error {
	if !aiMemoryCandidateMaintenance.TryLock() {
		return nil
	}
	defer aiMemoryCandidateMaintenance.Unlock()
	workspace := util.DataDir
	epoch := memoryWriteEpoch.Load()
	check := func() error {
		if memoryClearActive.Load() || memoryWriteEpoch.Load() != epoch {
			return errors.New("memory configuration changed")
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		if err := memoryWriteAllowed(); err != nil {
			return err
		}
		if Conf == nil || util.DataDir != workspace {
			return errors.New("memory workspace changed")
		}
		cfg := Conf.LoadAI()
		if cfg == nil || cfg.Memory == nil || !cfg.Memory.Enabled {
			return errors.New("automatic memory maintenance is disabled")
		}
		return nil
	}
	if check() != nil {
		return nil
	}
	removed, err := memo.NewStore(workspace).MaintainCandidates(ctx, now.Add(-aiMemoryCandidateRetention), check)
	if removed > 0 && util.DataDir == workspace {
		memoryChanged("")
	}
	return err
}
