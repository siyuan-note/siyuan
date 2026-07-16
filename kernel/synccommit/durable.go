// SiYuan - Refactor your thinking
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package synccommit

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"time"

	"github.com/siyuan-note/logging"
)

func OpenRootParent(workspaceRoot *os.Root, relativePath string, create bool) (*os.Root, string, error) {
	relativePath = filepath.Clean(relativePath)
	if !ValidRootRelativePath(relativePath, false) {
		return nil, "", ErrPathOutsideWorkspace
	}
	targetName := filepath.Base(relativePath)
	if targetName == "" || targetName == "." || targetName == ".." || filepath.Base(targetName) != targetName {
		return nil, "", errors.New("invalid workspace target name")
	}
	parentPath := filepath.Dir(relativePath)
	if create && parentPath != "." {
		if err := workspaceRoot.MkdirAll(parentPath, 0755); err != nil {
			return nil, "", err
		}
	}
	parent, err := workspaceRoot.OpenRoot(parentPath)
	if err != nil {
		return nil, "", err
	}
	return parent, targetName, nil
}

func StageFile(parent *os.Root, reader io.Reader, perm os.FileMode, modTime time.Time) (stagedName string, err error) {
	var random [16]byte
	var staged *os.File
	for attempt := 0; attempt < 16; attempt++ {
		if _, err = rand.Read(random[:]); err != nil {
			return "", err
		}
		stagedName = ".siyuan-stage-" + hex.EncodeToString(random[:]) + ".tmp"
		staged, err = parent.OpenFile(stagedName, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
		if err == nil {
			break
		}
		if !os.IsExist(err) {
			return "", err
		}
	}
	if staged == nil {
		return "", errors.New("unable to allocate staging file")
	}
	closed, keep := false, false
	defer func() {
		if !closed {
			_ = staged.Close()
		}
		if !keep {
			_ = parent.Remove(stagedName)
		}
	}()
	if _, err = io.Copy(staged, reader); err != nil {
		return "", err
	}
	if err = staged.Chmod(perm); err != nil {
		return "", err
	}
	if err = parent.Chtimes(stagedName, modTime, modTime); err != nil {
		return "", err
	}
	if err = staged.Sync(); err != nil {
		return "", err
	}
	if err = staged.Close(); err != nil {
		closed = true
		return "", err
	}
	closed, keep = true, true
	return stagedName, nil
}

func PublishStagedFile(parent *os.Root, stagedName, targetName string, noReplace bool) error {
	if targetName == "" || targetName == "." || targetName == ".." || filepath.Base(targetName) != targetName {
		return errors.New("invalid workspace target name")
	}
	if noReplace {
		if err := parent.Link(stagedName, targetName); err != nil {
			return err
		}
		if err := parent.Remove(stagedName); err != nil && !os.IsNotExist(err) {
			logging.LogWarnf("remove committed staging link failed: %s", err)
		}
	} else if err := parent.Rename(stagedName, targetName); err != nil {
		return err
	}
	return SyncRoot(parent)
}

func SyncRoot(parent *os.Root) error {
	directory, err := parent.Open(".")
	if err != nil {
		if runtime.GOOS == "windows" {
			return nil
		}
		return err
	}
	err = directory.Sync()
	closeErr := directory.Close()
	if runtime.GOOS == "windows" {
		return nil
	}
	return errors.Join(err, closeErr)
}

func MoveFile(source, target string, replace bool) error { return moveFile(source, target, replace) }
