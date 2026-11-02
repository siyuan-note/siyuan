// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package cmd

import (
	"context"
	"errors"
	"io"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/spf13/cobra"
)

func TestWorkspaceWaitExitSkipsWorkspaceInitialization(t *testing.T) {
	root := &cobra.Command{Use: "kernel", SilenceUsage: true, SilenceErrors: true,
		PersistentPreRunE:  func(*cobra.Command, []string) error { t.Fatal("initialized workspace"); return nil },
		PersistentPostRunE: func(*cobra.Command, []string) error { t.Fatal("flushed uninitialized databases"); return nil },
	}
	workspace := &cobra.Command{Use: "workspace"}
	observer := newWorkspaceWaitExitCmd()
	if !observer.Hidden {
		t.Fatal("internal observer must be hidden")
	}
	workspace.AddCommand(observer)
	root.AddCommand(workspace)
	input, writer := io.Pipe()
	t.Cleanup(func() { _ = input.Close(); _ = writer.Close() })
	root.SetIn(input)
	root.SetArgs([]string{"workspace", "wait-exit", "--pid", strconv.Itoa(os.Getpid()), "--started-at", "1"})
	if err := root.Execute(); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	observer.SetContext(ctx)
	root.SetArgs([]string{"workspace", "wait-exit", "--pid", strconv.Itoa(os.Getpid()), "--started-at", "1"})
	if err := root.ExecuteContext(ctx); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancellation lost: %v", err)
	}
}

func TestWorkspaceWaitExitStopsWhenHostPipeCloses(t *testing.T) {
	observer := newWorkspaceWaitExitCmd()
	observer.SetIn(strings.NewReader(""))
	observer.SetArgs([]string{"--pid", strconv.Itoa(os.Getpid()), "--started-at", strconv.FormatInt(time.Now().UnixMilli(), 10)})
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := observer.ExecuteContext(ctx); !errors.Is(err, context.Canceled) {
		t.Fatalf("host pipe EOF did not cancel observation: %v", err)
	}
}
