// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"crypto/sha256"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"

	"github.com/siyuan-note/filelock"
)

// A conflicting local asset must stop deletion, never replace an unrelated
// global asset. Previously copied files can be reused when the user retries.
func promoteAssetDirectory(source, destination string) error {
	return filelock.Walk(source, func(filename string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		rel, err := filepath.Rel(source, filename)
		if err != nil {
			return err
		}
		target := filepath.Join(destination, rel)
		if entry.Type()&os.ModeSymlink != 0 {
			return fmt.Errorf("cannot promote symbolic link asset: %s", filename)
		}
		if err = validateEncryptedCleanupPath(filepath.Dir(destination), target); err != nil {
			return err
		}
		if entry.IsDir() {
			return os.MkdirAll(target, 0755)
		}
		return copyPromotedAsset(filename, target)
	})
}

func copyPromotedAsset(source, destination string) (err error) {
	filelock.Lock(source)
	defer filelock.Unlock(source)
	filelock.Lock(destination)
	defer filelock.Unlock(destination)
	input, err := os.Open(source)
	if err != nil {
		return err
	}
	defer input.Close()
	info, err := input.Stat()
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() {
		return fmt.Errorf("cannot promote non-regular asset: %s", source)
	}
	output, err := os.OpenFile(destination, os.O_WRONLY|os.O_CREATE|os.O_EXCL, info.Mode().Perm())
	if os.IsExist(err) {
		existing, openErr := os.Open(destination)
		if openErr != nil {
			return openErr
		}
		defer existing.Close()
		existingInfo, statErr := existing.Stat()
		if statErr != nil {
			return statErr
		}
		if existingInfo.Mode().IsRegular() && info.Size() == existingInfo.Size() {
			originalHash, existingHash := sha256.New(), sha256.New()
			if _, err = io.Copy(originalHash, input); err != nil {
				return err
			}
			if _, err = io.Copy(existingHash, existing); err != nil {
				return err
			}
			if string(originalHash.Sum(nil)) == string(existingHash.Sum(nil)) {
				return nil
			}
		}
		return fmt.Errorf("local asset conflicts with existing global asset: %s", destination)
	}
	if err != nil {
		return err
	}
	defer func() {
		output.Close()
		if err != nil {
			os.Remove(destination)
		}
	}()
	if _, err = io.Copy(output, input); err != nil {
		return
	}
	if err = output.Sync(); err != nil {
		return
	}
	return output.Close()
}
