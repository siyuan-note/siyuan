// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package documentaddressing

import (
	"errors"
	"os"
	"path/filepath"
)

// CleanupRetiredRecords only removes local, identity-only addressing records.
// Notebook records, authenticated source data and encryption recovery material
// are outside this directory. The startup caller skips this in read-only mode.
func CleanupRetiredRecords(confDir string) error {
	if !filepath.IsAbs(confDir) {
		return ErrInvalid
	}
	if _, err := os.ReadDir(confDir); err != nil {
		if os.IsNotExist(err) {
			if _, statErr := os.Lstat(confDir); os.IsNotExist(statErr) {
				return nil
			}
		}
		return err
	}
	var failures []error
	for _, name := range []string{"document-addressing.json", "document-addressing-recovery"} {
		target := filepath.Join(confDir, name)
		relative, err := filepath.Rel(confDir, target)
		if err != nil || relative != name {
			return ErrInvalid
		}
		failures = append(failures, os.RemoveAll(target))
	}
	return errors.Join(failures...)
}
