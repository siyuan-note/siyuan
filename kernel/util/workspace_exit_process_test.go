// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package util

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/shirou/gopsutil/v4/process"
)

func TestWorkspaceExitProcessIdentity(t *testing.T) {
	for _, test := range []struct {
		name     string
		expected int64
		starts   []int64
	}{
		{"reused PID", 800, []int64{900}},
		{"legacy reused PID", 0, []int64{1001}},
		{"original exits", 800, []int64{800, 0}},
		{"legacy original exits", 0, []int64{800, 800, 0}},
		{"PID reused during waiting", 800, []int64{800, 900}},
		{"legacy PID reused during waiting", 0, []int64{800, 900}},
		{"old live batch", 800, []int64{800, 800, 0}},
	} {
		t.Run(test.name, func(t *testing.T) {
			calls := 0
			inspect := func(context.Context, int) (int64, error) {
				if calls >= len(test.starts) {
					t.Fatal("continued waiting for unrelated process")
				}
				value := test.starts[calls]
				calls++
				if value == 0 {
					return 0, process.ErrorProcessNotRunning
				}
				return value, nil
			}
			state := WorkspaceExitState{PID: 123, StartedAt: 1000, ProcessStartedAt: test.expected}
			if err := waitWorkspaceExitProcess(context.Background(), state, inspect, 0); err != nil {
				t.Fatal(err)
			}
			if calls != len(test.starts) {
				t.Fatalf("stopped before original exited: %d", calls)
			}
		})
	}
}

func TestWorkspaceExitProcessInspectionFailure(t *testing.T) {
	for _, failure := range []error{os.ErrPermission, errors.New("inspection unavailable")} {
		err := waitWorkspaceExitProcess(context.Background(), WorkspaceExitState{PID: 123, StartedAt: 1000},
			func(context.Context, int) (int64, error) { return 0, failure }, 0)
		if !errors.Is(err, failure) {
			t.Fatalf("inspection error lost: %v", err)
		}
	}
	for _, state := range []WorkspaceExitState{{}, {PID: -1, StartedAt: 1}, {PID: 1, StartedAt: -1},
		{PID: 1, StartedAt: 1, ProcessStartedAt: -1}} {
		if err := WaitWorkspaceExitProcess(context.Background(), state); err == nil {
			t.Fatal("invalid identity accepted")
		}
	}
}

func TestWorkspaceExitProcessNative(t *testing.T) {
	created, err := workspaceExitProcessStart(context.Background(), os.Getpid())
	if err != nil || created <= 0 {
		t.Fatalf("read current process identity: %d, %v", created, err)
	}
	for _, state := range []WorkspaceExitState{
		{PID: os.Getpid(), StartedAt: time.Now().UnixMilli(), ProcessStartedAt: created + 1},
		{PID: os.Getpid(), StartedAt: created - 1},
	} {
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		err = WaitWorkspaceExitProcess(ctx, state)
		cancel()
		if err != nil {
			t.Fatalf("waited for unrelated current process: %v", err)
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	err = WaitWorkspaceExitProcess(ctx, WorkspaceExitState{PID: os.Getpid(), StartedAt: time.Now().UnixMilli(), ProcessStartedAt: created})
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("living original did not wait for cancellation: %v", err)
	}
}
