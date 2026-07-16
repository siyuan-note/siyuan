//go:build !windows

// SiYuan - Refactor your thinking
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package synccommit

import "os"

func moveFile(source, target string, replace bool) error {
	if replace {
		return os.Rename(source, target)
	}
	if err := os.Link(source, target); err != nil {
		return err
	}
	_ = os.Remove(source)
	return nil
}
