// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"errors"
	"os"
	"path/filepath"
	"strings"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/siyuan/kernel/documentaddressing"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// CheckDocumentAddressingPath 在原始文件访问和修复前检查所属笔记本，也检查父目录覆盖的笔记本。
func CheckDocumentAddressingPath(absPath string) error {
	paths, err := documentAddressingDataPaths(absPath)
	if err != nil {
		return err
	}
	checked := map[string]bool{}
	for _, name := range paths {
		boxID, _, _ := strings.Cut(name, "/")
		boxID = strings.ToLower(boxID)
		if name == "" {
			entries, readErr := os.ReadDir(util.DataDir)
			if errors.Is(readErr, os.ErrNotExist) {
				continue
			}
			if readErr != nil {
				return readErr
			}
			for _, entry := range entries {
				if entry.IsDir() && ast.IsNodeIDPattern(entry.Name()) && !checked[entry.Name()] {
					if err = filesys.CheckDocumentAddressing(entry.Name()); err != nil {
						return err
					}
					checked[entry.Name()] = true
				}
			}
		} else if ast.IsNodeIDPattern(boxID) && !checked[boxID] {
			if err = filesys.CheckDocumentAddressing(boxID); err != nil {
				return err
			}
			checked[boxID] = true
		}
	}
	return nil
}

// documentAddressingDataPaths 同时保留逻辑路径和符号链接目标，尚不存在的尾部也参与检查。
func documentAddressingDataPaths(absPath string) ([]string, error) {
	if !filepath.IsAbs(util.DataDir) {
		return nil, nil
	}
	resolved, err := ResolveAssetPathWithMissingLeaf(absPath)
	if err != nil {
		return nil, err
	}
	root, err := ResolveAssetPathWithMissingLeaf(util.DataDir)
	if err != nil {
		return nil, err
	}
	var ret []string
	for _, pair := range [][2]string{{util.DataDir, absPath}, {root, resolved}} {
		base, name := filepath.Clean(pair[0]), filepath.Clean(pair[1])
		if rel, inside := dataRelativePath(base, name); inside {
			rel = strings.TrimPrefix(rel, "/")
			id, _, _ := strings.Cut(rel, "/")
			if rel == "" || ast.IsNodeIDPattern(strings.ToLower(id)) {
				ret = append(ret, rel)
			}
		} else if _, ancestor := dataRelativePath(name, base); ancestor {
			ret = append(ret, "")
		}
	}
	return ret, nil
}

// CheckDocumentAddressingFileWrite 在创建目录、覆盖配置或调整时间之前检查待写内容。
func CheckDocumentAddressingFileWrite(absPath string, data []byte, directory bool) error {
	if err := CheckDocumentAddressingPath(absPath); err != nil {
		return err
	}
	if directory {
		return nil
	}
	paths, err := documentAddressingDataPaths(absPath)
	if err != nil || len(paths) == 0 {
		return err
	}
	if err = documentaddressing.CheckPaths(paths, nil); err != nil {
		return err
	}
	if isDocumentAddressingSource(paths) {
		return checkDocumentAddressingSourceOverwrite(absPath, data)
	}
	return nil
}

// CheckDocumentAddressingFileCopies 预检全部目标内容，拒绝不兼容批次时不复制任何文件。
// sources 与 destinations 一一对应；目录内的文件使用复制后的相对位置检查。
func CheckDocumentAddressingFileCopies(sources, destinations []string) error {
	if len(sources) != len(destinations) {
		return documentaddressing.ErrInvalid
	}
	upserts := map[string]string{}
	var documents [][2]string
	for i, source := range sources {
		if err := CheckDocumentAddressingPath(source); err != nil {
			return err
		}
		if err := CheckDocumentAddressingPath(destinations[i]); err != nil {
			return err
		}
		// 复制工具遍历根目录链接，但忽略目录中的链接文件，预检保持相同范围。
		resolved, err := ResolveAssetPathWithMissingLeaf(source)
		if err != nil {
			return err
		}
		err = filepath.WalkDir(resolved, func(name string, entry os.DirEntry, walkErr error) error {
			if walkErr != nil {
				return walkErr
			}
			if entry.Type()&os.ModeSymlink != 0 {
				return nil
			}
			rel, relErr := filepath.Rel(resolved, name)
			if relErr != nil {
				return relErr
			}
			dest := filepath.Join(destinations[i], rel)
			if entry.IsDir() {
				return CheckDocumentAddressingPath(dest)
			}
			paths, pathErr := documentAddressingDataPaths(dest)
			if pathErr != nil {
				return pathErr
			}
			if isDocumentAddressingSource(paths) {
				documents = append(documents, [2]string{name, dest})
			}
			for _, path := range paths {
				if previous := upserts[path]; previous != "" && previous != name &&
					(strings.HasSuffix(path, "/"+documentaddressing.ConfigPath) || strings.HasSuffix(path, "/"+documentaddressing.FloorPath)) {
					return documentaddressing.ErrInvalid
				}
				upserts[path] = name
			}
			return nil
		})
		if err != nil {
			return err
		}
	}
	if len(upserts) == 0 {
		return nil
	}
	var paths []string
	for path := range upserts {
		paths = append(paths, path)
	}
	if err := documentaddressing.CheckPaths(paths, nil); err != nil {
		return err
	}
	for _, document := range documents {
		data, err := filelock.ReadFile(document[0])
		if err != nil {
			return err
		}
		if err = checkDocumentAddressingSourceOverwrite(document[1], data); err != nil {
			return err
		}
	}
	return nil
}

// CheckDocumentAddressingFileRemoval 校验整本删除：逐条检查树内文档寻址记录，无记录时校验该路径本身。
func CheckDocumentAddressingFileRemoval(absPath string) error {
	var removes []string
	err := filepath.WalkDir(absPath, func(name string, entry os.DirEntry, err error) error {
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		if err != nil || entry.IsDir() {
			return err
		}
		paths, err := documentAddressingDataPaths(name)
		removes = append(removes, paths...)
		return err
	})
	if err != nil || len(removes) == 0 {
		if err != nil {
			return err
		}
		return CheckDocumentAddressingPath(absPath)
	}
	return documentaddressing.CheckPaths(nil, removes)
}
