//go:build !windows

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
	"os"
)

func commitStorageRename(ctx context.Context, root *os.Root, oldName, newName string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	return root.Rename(oldName, newName)
}
