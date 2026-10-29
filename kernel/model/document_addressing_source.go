// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"bytes"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/88250/gulu"
	"github.com/88250/lute/ast"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// isDocumentAddressingSource 只识别以笔记本及文档 ID 组成的源路径，附件中的同名扩展不属于文档。
func isDocumentAddressingSource(paths []string) bool {
	for _, name := range paths {
		if runtime.GOOS == "windows" {
			name = strings.ToLower(name)
		}
		if !strings.HasSuffix(name, ".sy") {
			continue
		}
		parts := strings.Split(strings.TrimSuffix(name, ".sy"), "/")
		valid := len(parts) > 1
		for _, part := range parts {
			valid = valid && ast.IsNodeIDPattern(part)
		}
		if valid {
			return true
		}
	}
	return false
}

func checkDocumentAddressingSource(absPath string, data []byte) error {
	paths, err := documentAddressingDataPaths(absPath)
	if err != nil {
		return err
	}
	for _, doc := range documentSourcesFromPaths(paths) {
		if err = filesys.CheckDocumentSpecJSON(doc.BoxID, data); err != nil {
			return err
		}
	}
	return nil
}

// checkDocumentAddressingSourceOverwrite 在创建目录及写入批次前检查新旧文档；不修改原始字节。
func checkDocumentAddressingSourceOverwrite(absPath string, data []byte) error {
	if err := checkDocumentAddressingSource(absPath, data); err != nil {
		return err
	}
	paths, err := documentAddressingDataPaths(absPath)
	if err != nil {
		return err
	}
	if isDocumentAddressingSource(paths) {
		if err = treenode.CheckDocumentTitleWriteSpecJSON(bytes.TrimPrefix(data, []byte("\xef\xbb\xbf"))); err != nil {
			return err
		}
	}
	current, err := filelock.ReadFile(absPath)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	return checkDocumentAddressingSource(absPath, current)
}

// WriteFileWithDocumentAddressing 在文件锁内重新检查当前文档，再原样写入已验证的请求内容。
// 普通附件和插件文件保持原始文件写入语义；此函数不授予路径或加密笔记本访问权限。
func WriteFileWithDocumentAddressing(absPath string, data []byte) error {
	if err := CheckDocumentAddressingFileWrite(absPath, data, false); err != nil {
		return err
	}
	paths, err := documentAddressingDataPaths(absPath)
	if err != nil {
		return err
	}
	if !isDocumentAddressingSource(paths) {
		return util.WriteFileWithChangeTracking(absPath, data)
	}
	return filesys.MutateDocumentSources(documentSourcesFromPaths(paths), func() error {
		return util.WriteFileWithPreflight(absPath, data, false, func(current []byte) error {
			if current == nil {
				return nil
			}
			return checkDocumentAddressingSource(absPath, current)
		})
	})
}

func documentSourcesFromPaths(paths []string) (ret []*treenode.BlockTree) {
	for _, name := range paths {
		if runtime.GOOS == "windows" {
			name = strings.ToLower(name)
		}
		if !isDocumentAddressingSource([]string{name}) {
			continue
		}
		parts := strings.Split(name, "/")
		id := strings.TrimSuffix(parts[len(parts)-1], ".sy")
		ret = append(ret, &treenode.BlockTree{BoxID: parts[0], ID: id, RootID: id, Type: "d",
			Path: "/" + strings.Join(parts[1:], "/")})
	}
	return
}

// MutateDocumentAddressingFiles 在移动、删除前记录完整源集合；目标路径按源的相对位置映射。
func MutateDocumentAddressingFiles(source, destination string, mutate func() error) error {
	return filesys.MutateDocumentSourceSet(func() ([]*treenode.BlockTree, error) {
		return collectDocumentAddressingFiles(source, destination)
	}, mutate)
}

func collectDocumentAddressingFiles(source, destination string) ([]*treenode.BlockTree, error) {
	var documents []*treenode.BlockTree
	err := filepath.WalkDir(source, func(name string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() {
			return nil
		}
		paths, err := documentAddressingDataPaths(name)
		if err != nil {
			return err
		}
		documents = append(documents, documentSourcesFromPaths(paths)...)
		if destination != "" {
			relative, err := filepath.Rel(source, name)
			if err != nil {
				return err
			}
			paths, err = documentAddressingDataPaths(filepath.Join(destination, relative))
			if err != nil {
				return err
			}
			documents = append(documents, documentSourcesFromPaths(paths)...)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return documents, nil
}

// CopyFileWithDocumentAddressing 保留复制范围、权限和时间；文档使用已验证字节及受保护的目标写入。
// 调用方先检查整个请求批次，此处还会检查当前操作及实际读取的文档，拒绝检查后出现的不兼容源。
func CopyFileWithDocumentAddressing(source, destination string) error {
	if err := CheckDocumentAddressingFileCopies([]string{source}, []string{destination}); err != nil {
		return err
	}
	info, err := os.Stat(source)
	if err != nil {
		return err
	}
	if !info.IsDir() {
		return copyDocumentAddressingFile(source, destination)
	}
	if gulu.File.IsSubPath(source, destination) {
		return gulu.ErrCopyToSub
	}
	filelock.Lock(source)
	defer filelock.Unlock(source)
	return copyDocumentAddressingDirectory(source, destination)
}

func copyDocumentAddressingDirectory(source, destination string) error {
	info, err := os.Stat(source)
	if err != nil {
		return err
	}
	if err = os.MkdirAll(destination, 0755); err != nil {
		return err
	}
	entries, err := os.ReadDir(source)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		src, dest := filepath.Join(source, entry.Name()), filepath.Join(destination, entry.Name())
		if entry.IsDir() {
			err = copyDocumentAddressingDirectory(src, dest)
		} else {
			err = copyDocumentAddressingFile(src, dest)
		}
		if err != nil {
			return err
		}
	}
	return os.Chtimes(destination, info.ModTime(), info.ModTime())
}

func copyDocumentAddressingFile(source, destination string) error {
	info, err := os.Lstat(source)
	if err != nil || info.Mode()&os.ModeSymlink != 0 {
		return err
	}
	paths, err := documentAddressingDataPaths(destination)
	if err != nil {
		return err
	}
	if !isDocumentAddressingSource(paths) {
		return util.CopyFileWithChangeTracking(source, destination)
	}
	data, err := filelock.ReadFile(source)
	if err != nil {
		return err
	}
	if err = CheckDocumentAddressingFileWrite(destination, data, false); err != nil {
		return err
	}
	if err = os.MkdirAll(filepath.Dir(destination), 0755); err != nil {
		return err
	}
	if err = WriteFileWithDocumentAddressing(destination, data); err != nil {
		return err
	}
	if err = os.Chmod(destination, info.Mode()); err != nil {
		return err
	}
	return os.Chtimes(destination, info.ModTime(), info.ModTime())
}
