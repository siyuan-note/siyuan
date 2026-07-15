//go:build !windows

// SiYuan - Refactor your thinking
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

package api

import "os"

func moveStagedFile(source, target string, replace bool) error {
	if replace {
		return os.Rename(source, target)
	}
	if err := os.Link(source, target); err != nil {
		return err
	}
	// The target is already durably published. A failed cleanup is an orphaned
	// hidden temp file, not a failed logical mutation.
	_ = os.Remove(source)
	return nil
}
