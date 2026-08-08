//go:build windows

// SiYuan - Refactor your thinking
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

package plugin

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"golang.org/x/sys/windows"
)

func storageRenameTestError(err error) error {
	return &os.LinkError{Op: "rename", Old: "old", New: "new", Err: err}
}

func TestStorageRenameRetryPolicy(t *testing.T) {
	t.Run("transient success", func(t *testing.T) {
		attempts := 0
		waits := 0
		err := retryStorageRename(context.Background(), func() error {
			attempts++
			if attempts < 3 {
				return storageRenameTestError(windows.ERROR_SHARING_VIOLATION)
			}
			return nil
		}, func(_ context.Context, delay time.Duration) error {
			waits++
			if delay != storageRenameRetryDelay {
				t.Fatalf("retry delay = %v", delay)
			}
			return nil
		})
		if err != nil || attempts != 3 || waits != 2 {
			t.Fatalf("retry result err=%v attempts=%d waits=%d", err, attempts, waits)
		}
	})

	t.Run("transient classes", func(t *testing.T) {
		for _, transient := range []error{windows.ERROR_SHARING_VIOLATION, windows.ERROR_ACCESS_DENIED,
			windows.ERROR_LOCK_VIOLATION} {
			if !storageRenameErrorIsTransient(storageRenameTestError(transient)) {
				t.Errorf("error %v was not classified as transient", transient)
			}
		}
	})

	t.Run("non transient", func(t *testing.T) {
		attempts := 0
		waits := 0
		err := retryStorageRename(context.Background(), func() error {
			attempts++
			return storageRenameTestError(windows.ERROR_FILE_NOT_FOUND)
		}, func(context.Context, time.Duration) error {
			waits++
			return nil
		})
		if !errors.Is(err, windows.ERROR_FILE_NOT_FOUND) || attempts != 1 || waits != 0 {
			t.Fatalf("retry result err=%v attempts=%d waits=%d", err, attempts, waits)
		}
	})

	t.Run("retry limit", func(t *testing.T) {
		attempts := 0
		waits := 0
		err := retryStorageRename(context.Background(), func() error {
			attempts++
			return storageRenameTestError(windows.ERROR_LOCK_VIOLATION)
		}, func(context.Context, time.Duration) error {
			waits++
			return nil
		})
		if !errors.Is(err, windows.ERROR_LOCK_VIOLATION) || attempts != 4 || waits != 3 {
			t.Fatalf("retry result err=%v attempts=%d waits=%d", err, attempts, waits)
		}
	})

	t.Run("canceled", func(t *testing.T) {
		ctx, cancel := context.WithCancel(context.Background())
		attempts := 0
		err := retryStorageRename(ctx, func() error {
			attempts++
			return storageRenameTestError(windows.ERROR_ACCESS_DENIED)
		}, func(context.Context, time.Duration) error {
			cancel()
			return ctx.Err()
		})
		if !errors.Is(err, context.Canceled) || attempts != 1 {
			t.Fatalf("retry result err=%v attempts=%d", err, attempts)
		}
	})
}
