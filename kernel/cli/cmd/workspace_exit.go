// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package cmd

import (
	"context"
	"io"

	"github.com/siyuan-note/siyuan/kernel/util"
	"github.com/spf13/cobra"
)

// 桌面宿主用独立观察进程等待旧内核，避免在 Electron 中依赖平台命令和本地扩展。
func newWorkspaceWaitExitCmd() *cobra.Command {
	var state util.WorkspaceExitState
	command := &cobra.Command{
		Use: "wait-exit", Hidden: true, Args: cobra.NoArgs,
		PersistentPreRunE:  func(*cobra.Command, []string) error { return nil },
		PersistentPostRunE: func(*cobra.Command, []string) error { return nil },
		RunE: func(cmd *cobra.Command, _ []string) error {
			ctx, cancel := context.WithCancel(cmd.Context())
			defer cancel()
			// 宿主关闭或崩溃后管道会到达 EOF，观察进程随之退出。
			go func() {
				_, _ = io.Copy(io.Discard, cmd.InOrStdin())
				cancel()
			}()
			return util.WaitWorkspaceExitProcess(ctx, state)
		},
	}
	command.Flags().IntVar(&state.PID, "pid", 0, "exiting kernel process ID")
	command.Flags().Int64Var(&state.StartedAt, "started-at", 0, "exit request time in Unix milliseconds")
	command.Flags().Int64Var(&state.ProcessStartedAt, "process-started-at", 0, "process creation time in Unix milliseconds")
	return command
}

func init() {
	workspaceCmd.AddCommand(newWorkspaceWaitExitCmd())
}
