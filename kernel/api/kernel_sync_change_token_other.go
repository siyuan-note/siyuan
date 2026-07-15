//go:build !windows && !linux && !darwin

// SiYuan - Refactor your thinking
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

package api

import (
	"fmt"
	"os"
)

func fileChangeToken(_ *os.File, info os.FileInfo) (string, error) {
	return fmt.Sprintf("v1:%d:%d", info.Size(), info.ModTime().UnixNano()), nil
}
