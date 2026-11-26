// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"

	"github.com/siyuan-note/siyuan/kernel/util"
)

func installImportedAsset(root *os.Root, sourcePath, targetPath string) (string, error) {
	annotationPath := sourcePath + ".sya"
	annotation, err := os.Lstat(annotationPath)
	if err != nil && !errors.Is(err, fs.ErrNotExist) {
		return "", err
	}
	if annotation != nil && !annotation.Mode().IsRegular() {
		return "", fmt.Errorf("import non-regular asset annotation [%s]: %w", annotationPath, fs.ErrInvalid)
	}
	originalPath := targetPath
	nextPath := func() string {
		name := util.FilterUploadFileName(filepath.Base(originalPath))
		return filepath.Join(filepath.Dir(originalPath), newAssetFileName(name))
	}
	for {
		if _, err = root.Lstat(targetPath + ".sya"); err == nil {
			targetPath = nextPath()
			continue
		} else if !errors.Is(err, fs.ErrNotExist) {
			return "", err
		}
		err = copyImportedAsset(root, sourcePath, targetPath)
		if err == nil && annotation != nil {
			err = copyImportedAsset(root, annotationPath, targetPath+".sya")
			if err != nil {
				if removeErr := root.Remove(targetPath); removeErr != nil {
					return "", errors.Join(err, removeErr)
				}
			}
		}
		if errors.Is(err, fs.ErrExist) {
			targetPath = nextPath()
			continue
		}
		return targetPath, err
	}
}

func copyImportedAsset(root *os.Root, sourcePath, targetPath string) (err error) {
	if _, err = root.Lstat(targetPath); err == nil {
		return fs.ErrExist
	} else if !errors.Is(err, fs.ErrNotExist) {
		return err
	}
	input, err := os.Open(sourcePath)
	if err != nil {
		return err
	}
	defer input.Close()
	output, err := root.OpenFile(targetPath, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0644)
	if err != nil {
		return err
	}
	_, err = io.Copy(output, input)
	closeErr := output.Close()
	if err = errors.Join(err, closeErr); err != nil {
		err = errors.Join(err, root.Remove(targetPath))
	}
	return err
}
