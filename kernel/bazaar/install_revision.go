// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
// Licensed under the GNU Affero General Public License, version 3 or later.

package bazaar

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"strings"

	"github.com/siyuan-note/siyuan/kernel/util"
)

const MissingInstalledRevision = "missing"

var (
	ErrInstalledRevisionConflict = errors.New("revision_conflict: installed package changed")
	ErrPackageHashConflict       = errors.New("package_hash_conflict: package archive changed")
)

// PackageInstallOptions 只由宿主安装服务构造，回调在共用安装锁内执行。
type PackageInstallOptions struct {
	ExpectedInstalledRevision string
	PrivateTemp               bool
	BeforeReplace             func() error
	Context                   context.Context
	Recheck                   func() error
}

func (options PackageInstallOptions) context() context.Context {
	if options.Context == nil {
		return context.Background()
	}
	return options.Context
}

func (options PackageInstallOptions) check() error {
	if err := options.context().Err(); err != nil {
		return err
	}
	if options.Recheck != nil {
		if err := options.Recheck(); err != nil {
			return err
		}
	}
	return options.context().Err()
}

type PackageInstallResult struct {
	InstalledRevision string
	PreviousRevision  string
}

func validInstallHash(hash string) bool {
	data, err := hex.DecodeString(hash)
	return err == nil && len(data) == sha256.Size && hash == strings.ToLower(hash)
}

func validateInstalledRevision(revision string) error {
	if revision != "" && revision != MissingInstalledRevision && !validInstallHash(revision) {
		return errors.New("invalid installed package revision")
	}
	return nil
}

// InstalledPackageRevision 在与安装、卸载相同的锁内读取完整代码目录摘要。
func InstalledPackageRevision(installPath string) (string, error) {
	if err := packageInstallLock.Acquire(context.Background(), 1); err != nil {
		return "", err
	}
	defer packageInstallLock.Release(1)
	if err := rejectInstallPathLinks(installPath); err != nil {
		return "", err
	}
	return installedPackageRevision(installPath)
}

func installedPackageRevision(installPath string) (string, error) {
	if _, err := os.Lstat(installPath); os.IsNotExist(err) {
		return MissingInstalledRevision, nil
	} else if err != nil {
		return "", err
	}
	return visitInstallTree(installPath, nil)
}

func validateInstallRelativePath(name string) error {
	if name == "" || name == "." || name != path.Clean(name) || strings.HasPrefix(name, "/") ||
		strings.ContainsAny(name, "\\:\x00") {
		return errors.New("invalid marketplace package path")
	}
	for _, component := range strings.Split(name, "/") {
		if component == ".." || strings.TrimRight(component, ". ") != component {
			return errors.New("invalid marketplace package path")
		}
	}
	return nil
}

// visitInstallTree 固定目录句柄逐项读取，摘要包含排序后的路径、文件字节和空目录。
// 对遵循安装锁的写入提供串行化；外部编辑器仍须靠替换前复核发现冲突。
func visitInstallTree(rootPath string, consume func(string, fs.FileInfo, []byte) error) (string, error) {
	info, err := os.Lstat(rootPath)
	if err != nil {
		return "", err
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return "", errors.New("marketplace package root must be an unlinked directory")
	}
	root, err := os.OpenRoot(rootPath)
	if err != nil {
		return "", err
	}
	defer root.Close()
	opened, err := root.Stat(".")
	if err != nil || !os.SameFile(info, opened) {
		return "", ErrInstalledRevisionConflict
	}
	digest := sha256.New()
	io.WriteString(digest, "siyuan-installed-package-v1\x00")
	var total int64
	count := 0
	seen := map[string]bool{}
	err = fs.WalkDir(root.FS(), ".", func(name string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil || name == "." {
			return walkErr
		}
		if err := validateInstallRelativePath(name); err != nil {
			return err
		}
		key := strings.ToLower(name)
		if seen[key] {
			return errors.New("marketplace package contains colliding paths")
		}
		seen[key] = true
		info, err := root.Lstat(name)
		if err != nil {
			return err
		}
		if info.Mode()&os.ModeSymlink != 0 || (!info.IsDir() && !info.Mode().IsRegular()) {
			return errors.New("marketplace package contains an unsupported file")
		}
		count++
		if count > maxLocalPackageFileCount {
			return errors.New("marketplace package contains too many files")
		}
		if info.IsDir() {
			fmt.Fprintf(digest, "d:%d:%s\x00", len(name), name)
			if consume != nil {
				return consume(name, info, nil)
			}
			return nil
		}
		if info.Size() < 0 || info.Size() > int64(maxLocalPackageFileSize) || total > int64(maxLocalPackageExtractSize)-info.Size() {
			return errors.New("marketplace package is too large")
		}
		data, err := readInstallFileAt(root, name, info, int64(maxLocalPackageFileSize))
		if err != nil {
			return err
		}
		total += int64(len(data))
		if total > int64(maxLocalPackageExtractSize) {
			return errors.New("marketplace package is too large")
		}
		fmt.Fprintf(digest, "f:%d:%s:%d:%x\x00", len(name), name, len(data), sha256.Sum256(data))
		if consume != nil {
			return consume(name, info, data)
		}
		return nil
	})
	if err != nil {
		return "", err
	}
	after, err := os.Lstat(rootPath)
	if err != nil || !os.SameFile(info, after) {
		return "", ErrInstalledRevisionConflict
	}
	return fmt.Sprintf("%x", digest.Sum(nil)), nil
}

func readInstallFile(file *os.File, expected fs.FileInfo, maxSize int64) ([]byte, error) {
	before, err := file.Stat()
	if err != nil {
		return nil, err
	}
	if !before.Mode().IsRegular() || !os.SameFile(before, expected) || before.Size() > maxSize {
		return nil, errors.New("invalid marketplace package file")
	}
	if err = util.CheckSingleLinkRegularFile(file); err != nil {
		return nil, err
	}
	data, err := io.ReadAll(io.LimitReader(file, maxSize+1))
	if err != nil {
		return nil, err
	}
	after, err := file.Stat()
	if err != nil || !os.SameFile(before, after) || before.Size() != after.Size() || !before.ModTime().Equal(after.ModTime()) || int64(len(data)) != after.Size() {
		return nil, ErrInstalledRevisionConflict
	}
	if int64(len(data)) > maxSize {
		return nil, errors.New("marketplace package is too large")
	}
	return data, nil
}

func readInstallArchive(archivePath string) ([]byte, error) {
	return readInstallRegularPath(archivePath, MaxLocalPackageArchiveSize)
}

// readInstallRegularPath 固定已验证的父目录，避免最终文件被替换为 FIFO 或链接时阻塞或跟随链接。
func readInstallRegularPath(filePath string, maxSize int64) ([]byte, error) {
	directory, err := filepath.Abs(filepath.Dir(filePath))
	if err != nil {
		return nil, err
	}
	if err = rejectInstallPathLinks(directory); err != nil {
		return nil, err
	}
	directoryInfo, err := os.Lstat(directory)
	if err != nil {
		return nil, err
	}
	root, err := os.OpenRoot(directory)
	if err != nil {
		return nil, err
	}
	defer root.Close()
	opened, err := root.Stat(".")
	if err != nil || !os.SameFile(directoryInfo, opened) {
		return nil, ErrInstalledRevisionConflict
	}
	name := filepath.Base(filePath)
	info, err := root.Lstat(name)
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() {
		return nil, errors.New("marketplace package file must be an unlinked regular file")
	}
	return readInstallFileAt(root, name, info, maxSize)
}

func readInstallFileAt(root *os.Root, name string, expected fs.FileInfo, maxSize int64) ([]byte, error) {
	file, err := util.OpenFileNoFollow(root, name)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	return readInstallFile(file, expected, maxSize)
}

func copyInstallTree(sourcePath, destination string) (string, error) {
	if err := os.Mkdir(destination, 0700); err != nil {
		return "", err
	}
	return visitInstallTree(sourcePath, func(name string, info fs.FileInfo, data []byte) error {
		target := filepath.Join(destination, filepath.FromSlash(name))
		if info.IsDir() {
			return os.Mkdir(target, 0755)
		}
		file, err := os.OpenFile(target, os.O_CREATE|os.O_EXCL|os.O_WRONLY, info.Mode().Perm()&0777)
		if err != nil {
			return err
		}
		_, err = file.Write(data)
		if err == nil {
			err = file.Sync()
		}
		closeErr := file.Close()
		if err != nil {
			return err
		}
		return closeErr
	})
}
