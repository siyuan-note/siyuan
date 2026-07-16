//go:build !windows

// SiYuan - Refactor your thinking
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package synccommit

import "path/filepath"

func canonicalFileLockPath(path string) string        { return filepath.Clean(path) }
func canonicalLexicalFileLockPath(path string) string { return filepath.Clean(path) }
func resolveExistingPath(path string) (string, error) { return filepath.EvalSymlinks(path) }
