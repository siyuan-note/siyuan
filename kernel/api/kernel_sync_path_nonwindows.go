//go:build !windows

// SiYuan - Refactor your thinking
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

package api

import "path/filepath"

// Unix filesystems may be case-sensitive, so changing the spelling would
// incorrectly merge distinct lock keys. filepath.Clean is the only portable
// canonicalization shared with filelock callers on these platforms.
func canonicalFileLockPath(path string) string {
	return filepath.Clean(path)
}

func canonicalLexicalFileLockPath(path string) string {
	return filepath.Clean(path)
}

func resolveExistingPath(path string) (string, error) {
	return filepath.EvalSymlinks(path)
}
