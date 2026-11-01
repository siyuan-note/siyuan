// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package util

import (
	"context"
	"errors"
	"fmt"
	"os"
	"time"

	"github.com/shirou/gopsutil/v4/process"
)

func workspaceExitProcessStart(ctx context.Context, pid int) (int64, error) {
	// 每次创建查询对象，避免复用 gopsutil 缓存的创建时间。
	proc, err := process.NewProcessWithContext(ctx, int32(pid))
	if err != nil {
		return 0, err
	}
	created, err := proc.CreateTimeWithContext(ctx)
	if err != nil {
		// 进程可能在存在性检查和身份查询之间结束；查询权限错误仍需报告。
		if exists, checkErr := process.PidExistsWithContext(ctx, int32(pid)); checkErr == nil && !exists {
			return 0, process.ErrorProcessNotRunning
		}
	}
	return created, err
}

// WaitWorkspaceExitProcess 仅观察进程身份，不打开工作空间、删除标记或终止进程。
func WaitWorkspaceExitProcess(ctx context.Context, state WorkspaceExitState) error {
	return waitWorkspaceExitProcess(ctx, state, workspaceExitProcessStart, 200*time.Millisecond)
}

func waitWorkspaceExitProcess(ctx context.Context, state WorkspaceExitState,
	inspect func(context.Context, int) (int64, error), interval time.Duration) error {
	if state.PID <= 0 || int64(state.PID) > 1<<31-1 || state.StartedAt <= 0 || state.ProcessStartedAt < 0 {
		return fmt.Errorf("invalid workspace exit process identity")
	}
	expected := state.ProcessStartedAt
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		created, err := inspect(ctx, state.PID)
		if errors.Is(err, process.ErrorProcessNotRunning) || errors.Is(err, os.ErrNotExist) {
			return nil
		}
		if err != nil {
			return fmt.Errorf("inspect workspace exit process: %w", err)
		}
		if created <= 0 {
			return fmt.Errorf("workspace exit process creation time unavailable")
		}
		// v1/v2 旧标记没有创建时间：退出请求之后创建的进程不可能属于该退出批次。
		if (expected != 0 && created != expected) || (expected == 0 && created > state.StartedAt) {
			return nil
		}
		expected = created
		timer := time.NewTimer(interval)
		select {
		case <-ctx.Done():
			timer.Stop()
			return ctx.Err()
		case <-timer.C:
		}
	}
}
