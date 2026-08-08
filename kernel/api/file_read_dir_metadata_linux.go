//go:build linux

// SiYuan - Refactor your thinking
// Copyright (c) 2020-present, b3log.org

package api

import (
	"errors"
	"os"

	"golang.org/x/sys/unix"
)

func captureReadDirMetadataReference(directory *os.File, name string) (reference *readDirMetadataReference, err error) {
	fd, err := unix.Openat(int(directory.Fd()), name, unix.O_PATH|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0)
	if err != nil {
		return nil, err
	}
	file := os.NewFile(uintptr(fd), name)
	if file == nil {
		_ = unix.Close(fd)
		return nil, errors.New("failed to create directory entry metadata handle")
	}
	defer func() {
		if err != nil {
			err = errors.Join(err, file.Close())
		}
	}()

	info, err := file.Stat()
	if err == nil {
		err = pinWorkspaceFileInfo(info)
	}
	if err != nil {
		return nil, err
	}
	return &readDirMetadataReference{
		info:     info,
		sameFile: func(other os.FileInfo) bool { return os.SameFile(info, other) },
		close:    file.Close,
	}, nil
}
