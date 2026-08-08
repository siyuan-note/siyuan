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
	"time"

	"golang.org/x/sys/windows"
)

const (
	storageRenameRetryCount = 3
	storageRenameRetryDelay = 200 * time.Millisecond
)

func storageRenameErrorIsTransient(err error) bool {
	return errors.Is(err, windows.ERROR_SHARING_VIOLATION) || errors.Is(err, windows.ERROR_ACCESS_DENIED) ||
		errors.Is(err, windows.ERROR_LOCK_VIOLATION)
}

func waitStorageRenameRetry(ctx context.Context, delay time.Duration) error {
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

func retryStorageRename(ctx context.Context, rename func() error, wait func(context.Context, time.Duration) error) error {
	for retry := 0; ; retry++ {
		if err := ctx.Err(); err != nil {
			return err
		}
		err := rename()
		if err == nil || retry >= storageRenameRetryCount || !storageRenameErrorIsTransient(err) {
			return err
		}
		if err = wait(ctx, storageRenameRetryDelay); err != nil {
			return err
		}
	}
}

func commitStorageRename(ctx context.Context, root *os.Root, oldName, newName string) error {
	return retryStorageRename(ctx, func() error {
		return root.Rename(oldName, newName)
	}, waitStorageRenameRetry)
}
