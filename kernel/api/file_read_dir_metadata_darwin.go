//go:build darwin

// SiYuan - Refactor your thinking
// Copyright (c) 2020-present, b3log.org

package api

import (
	"os"
	"runtime"
	"syscall"
	"time"

	"golang.org/x/sys/unix"
)

type darwinReadDirFileInfo struct {
	name    string
	size    int64
	mode    os.FileMode
	modTime time.Time
}

func (info *darwinReadDirFileInfo) Name() string       { return info.name }
func (info *darwinReadDirFileInfo) Size() int64        { return info.size }
func (info *darwinReadDirFileInfo) Mode() os.FileMode  { return info.mode }
func (info *darwinReadDirFileInfo) ModTime() time.Time { return info.modTime }
func (info *darwinReadDirFileInfo) IsDir() bool        { return info.mode.IsDir() }
func (info *darwinReadDirFileInfo) Sys() any           { return nil }

type darwinReadDirIdentity struct {
	device     int32
	inode      uint64
	generation uint32
}

func captureReadDirMetadataReference(directory *os.File, name string) (*readDirMetadataReference, error) {
	stat, err := darwinReadDirStatAt(directory, name)
	if err != nil {
		return nil, err
	}
	identity := darwinReadDirIdentity{device: stat.Dev, inode: stat.Ino, generation: stat.Gen}
	fileType := stat.Mode & unix.S_IFMT
	info := &darwinReadDirFileInfo{
		name:    name,
		size:    stat.Size,
		mode:    darwinReadDirMode(stat.Mode),
		modTime: time.Unix(stat.Mtim.Unix()),
	}

	// Darwin has no public metadata-only entry handle equivalent to Linux
	// O_PATH or Windows FILE_READ_ATTRIBUTES. Repeated fstatat observations do
	// not open the entry and therefore cannot trigger FIFO/device open behavior
	// or require file-content read permission. They cannot exclude an ABA
	// replacement that restores the same filesystem identity between calls.
	return &readDirMetadataReference{
		info: info,
		sameFile: func(other os.FileInfo) bool {
			return identity.matchesFileInfo(other)
		},
		revalidate: func() error {
			after, statErr := darwinReadDirStatAt(directory, name)
			if statErr != nil {
				return statErr
			}
			if !identity.matchesStat(after) || after.Mode&unix.S_IFMT != fileType {
				return errReadDirEntryChanged
			}
			return nil
		},
	}, nil
}

func darwinReadDirStatAt(directory *os.File, name string) (*unix.Stat_t, error) {
	var stat unix.Stat_t
	err := unix.Fstatat(int(directory.Fd()), name, &stat, unix.AT_SYMLINK_NOFOLLOW)
	runtime.KeepAlive(directory)
	if err != nil {
		return nil, err
	}
	return &stat, nil
}

func (identity darwinReadDirIdentity) matchesStat(stat *unix.Stat_t) bool {
	return stat != nil && identity.device == stat.Dev && identity.inode == stat.Ino && identity.generation == stat.Gen
}

func (identity darwinReadDirIdentity) matchesFileInfo(info os.FileInfo) bool {
	stat, ok := info.Sys().(*syscall.Stat_t)
	return ok && identity.device == stat.Dev && identity.inode == stat.Ino && identity.generation == stat.Gen
}

func darwinReadDirMode(raw uint16) os.FileMode {
	mode := os.FileMode(raw & 0777)
	switch raw & unix.S_IFMT {
	case unix.S_IFBLK, unix.S_IFWHT:
		mode |= os.ModeDevice
	case unix.S_IFCHR:
		mode |= os.ModeDevice | os.ModeCharDevice
	case unix.S_IFDIR:
		mode |= os.ModeDir
	case unix.S_IFIFO:
		mode |= os.ModeNamedPipe
	case unix.S_IFLNK:
		mode |= os.ModeSymlink
	case unix.S_IFSOCK:
		mode |= os.ModeSocket
	}
	if raw&unix.S_ISGID != 0 {
		mode |= os.ModeSetgid
	}
	if raw&unix.S_ISUID != 0 {
		mode |= os.ModeSetuid
	}
	if raw&unix.S_ISVTX != 0 {
		mode |= os.ModeSticky
	}
	return mode
}
