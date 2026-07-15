// SiYuan - Refactor your thinking
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

package api

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"io"
	"os"
	"path/filepath"
	"time"

	"github.com/siyuan-note/logging"
)

// openRootParentForCommit creates and opens a target's parent beneath an
// already-verified workspace root. The returned Root pins the actual parent
// directory, so later link/junction replacement of its lexical path cannot
// redirect staging or publication.
func openRootParentForCommit(workspaceRoot *os.Root, relativePath string, create bool) (*os.Root, string, error) {
	relativePath = filepath.Clean(relativePath)
	if !validWorkspaceRootRelativePath(relativePath, false) {
		return nil, "", errWorkspacePathOutside
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

// stageFileForRootCommit copies a stream into a durable hidden file through a
// pinned parent Root. Permissions and timestamps are applied before
// publication so a successful commit cannot later be reported as a partial
// metadata failure.
func stageFileForRootCommit(parent *os.Root, reader io.Reader, perm os.FileMode, modTime time.Time) (stagedName string, err error) {
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
	closed := false
	keep := false
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
	closed = true
	keep = true
	return stagedName, nil
}

func commitRootStagedFile(parent *os.Root, stagedName, targetName string, noReplace bool) error {
	if targetName == "" || targetName == "." || targetName == ".." || filepath.Base(targetName) != targetName {
		return errors.New("invalid workspace target name")
	}
	if noReplace {
		// A same-directory hard link is an atomic create-if-absent operation on
		// both Unix and Windows. It preserves ifNoneMatch without a check/use gap.
		if err := parent.Link(stagedName, targetName); err != nil {
			return err
		}
		if err := parent.Remove(stagedName); err != nil && !os.IsNotExist(err) {
			// The target is already committed. Leaving an unreachable hidden
			// staging link is cleanup debt, not a failed logical mutation.
			logging.LogWarnf("remove committed staging link failed: %s", err)
		}
	} else if err := parent.Rename(stagedName, targetName); err != nil {
		return err
	}
	// Directory fsync is not supported uniformly (notably on Windows). The
	// file itself is already synced; failure here is diagnostic only because
	// publication has succeeded and must not be reported as a failed mutation.
	if dir, err := parent.Open("."); err == nil {
		if syncErr := dir.Sync(); syncErr != nil {
			logging.LogWarnf("sync committed file parent directory failed: %s", syncErr)
		}
		_ = dir.Close()
	}
	return nil
}
