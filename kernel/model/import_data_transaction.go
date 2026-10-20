// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

package model

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"slices"
	"sort"
	"strings"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/util"
)

type dataImportFile struct {
	Path   string              `json:"path"`
	Exists bool                `json:"exists"`
	Before notebookArchiveFile `json:"before"`
	After  notebookArchiveFile `json:"after"`
}

type dataImportOperation struct {
	Version int              `json:"version"`
	State   string           `json:"state"`
	Files   []dataImportFile `json:"files"`
	Dirs    []string         `json:"dirs"`
}

func dataImportFingerprint(p string) (notebookArchiveFile, error) {
	file, err := os.Open(p)
	if err != nil {
		return notebookArchiveFile{}, err
	}
	defer file.Close()
	return archiveFingerprint(file)
}

// copyDataImportFile 流式写入同目录临时文件，刷盘后替换，不把大资源整体载入内存。
func copyDataImportFile(source, target string) (err error) {
	if err = os.MkdirAll(filepath.Dir(target), 0700); err != nil {
		return
	}
	input, err := os.Open(source)
	if err != nil {
		return
	}
	defer input.Close()
	output, err := os.CreateTemp(filepath.Dir(target), ".data-import-*.tmp")
	if err != nil {
		return
	}
	defer func() {
		output.Close()
		os.Remove(output.Name())
	}()
	if _, err = io.Copy(output, input); err != nil {
		return
	}
	if err = output.Sync(); err != nil {
		return
	}
	if err = output.Close(); err != nil {
		return
	}
	return os.Rename(output.Name(), target)
}

func dataImportTarget(name string) (string, error) {
	if !archiveRelativePath(name) || strings.ToLower(name) == ".siyuan/master-password-migration.json" {
		return "", errors.New(Conf.Language(422))
	}
	target := filepath.Join(util.DataDir, filepath.FromSlash(name))
	if err := validateEncryptedCleanupPath(util.DataDir, target); err != nil {
		return "", err
	}
	if info, err := os.Lstat(target); err == nil && !info.Mode().IsRegular() {
		return "", errors.New(Conf.Language(422))
	} else if err != nil && !os.IsNotExist(err) {
		return "", err
	}
	return target, nil
}

// applyDataImport 先备份全部待覆盖文件，再登记提交日志；任何写入失败都补偿已安装的路径。
func applyDataImport(directory, install string, write func(string, string) error) error {
	files, err := archiveDirectoryFiles(install)
	if err != nil {
		return err
	}
	operation := &dataImportOperation{Version: 1, State: "committing", Files: []dataImportFile{}, Dirs: []string{}}
	names := make([]string, 0, len(files))
	for name := range files {
		names = append(names, name)
	}
	sort.Strings(names)
	dirs := map[string]bool{}
	for _, name := range names {
		target, targetErr := dataImportTarget(name)
		if targetErr != nil {
			return targetErr
		}
		entry := dataImportFile{Path: name, After: files[name]}
		entry.Before, err = dataImportFingerprint(target)
		if err == nil {
			entry.Exists = true
			if entry.Before == entry.After {
				continue
			}
			backup := filepath.Join(directory, "rollback", filepath.FromSlash(name))
			if err = copyDataImportFile(target, backup); err != nil {
				return err
			}
			if actual, readErr := dataImportFingerprint(backup); readErr != nil || actual != entry.Before {
				return errors.New(Conf.Language(422))
			}
		} else if !os.IsNotExist(err) {
			return err
		}
		for parent := filepath.Dir(name); parent != "."; parent = filepath.Dir(parent) {
			if _, statErr := os.Lstat(filepath.Join(util.DataDir, parent)); os.IsNotExist(statErr) {
				dirs[filepath.ToSlash(parent)] = true
			} else if statErr != nil {
				return statErr
			}
		}
		operation.Files = append(operation.Files, entry)
	}
	for directory := range dirs {
		operation.Dirs = append(operation.Dirs, directory)
	}
	sort.Strings(operation.Dirs)
	if err = writeDataImportJSON(filepath.Join(directory, "operation.json"), operation); err != nil {
		return err
	}
	for _, entry := range operation.Files {
		target, targetErr := dataImportTarget(entry.Path)
		if targetErr == nil {
			actual, readErr := dataImportFingerprint(target)
			if entry.Exists && (readErr != nil || actual != entry.Before) || !entry.Exists && !os.IsNotExist(readErr) {
				targetErr = errors.New(Conf.Language(422))
			}
		}
		if targetErr == nil {
			targetErr = write(filepath.Join(install, filepath.FromSlash(entry.Path)), target)
		}
		if targetErr != nil {
			return errors.Join(targetErr, rollbackDataImport(directory, operation))
		}
	}
	operation.State = "committed"
	if err = writeDataImportJSON(filepath.Join(directory, "operation.json"), operation); err != nil {
		operation.State = "committing"
		return errors.Join(err, rollbackDataImport(directory, operation))
	}
	return nil
}

func rollbackDataImport(directory string, operation *dataImportOperation) error {
	for _, entry := range slices.Backward(operation.Files) {
		target, err := dataImportTarget(entry.Path)
		if err != nil {
			return err
		}
		actual, readErr := dataImportFingerprint(target)
		if entry.Exists && readErr == nil && actual == entry.Before || !entry.Exists && os.IsNotExist(readErr) {
			continue
		}
		if readErr != nil && !os.IsNotExist(readErr) || readErr == nil && actual != entry.After {
			return errors.New(Conf.Language(424))
		}
		if entry.Exists {
			backup := filepath.Join(directory, "rollback", filepath.FromSlash(entry.Path))
			if original, backupErr := dataImportFingerprint(backup); backupErr != nil || original != entry.Before {
				return errors.New(Conf.Language(424))
			}
			if err = copyDataImportFile(backup, target); err != nil {
				return err
			}
		} else if err = os.Remove(target); err != nil && !os.IsNotExist(err) {
			return err
		}
	}
	for _, name := range slices.Backward(operation.Dirs) {
		if !archiveRelativePath(name) {
			return errors.New(Conf.Language(424))
		}
		target := filepath.Join(util.DataDir, filepath.FromSlash(name))
		if err := validateEncryptedCleanupPath(util.DataDir, target); err != nil {
			return err
		}
		// 仅移除本次创建的空目录，不递归删除后来出现的文件。
		if entries, err := os.ReadDir(target); err == nil && len(entries) == 0 {
			if err = os.Remove(target); err != nil {
				return err
			}
		} else if err != nil && !os.IsNotExist(err) {
			return err
		}
	}
	operation.State = "rolledback"
	return writeDataImportJSON(filepath.Join(directory, "operation.json"), operation)
}

// recoverDataImports 在挂载和同步前补偿未完成的批次，成功批次的原件和恢复材料继续保留。
func recoverDataImports() error {
	entries, err := os.ReadDir(dataImportBase())
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if !entry.IsDir() || !ast.IsNodeIDPattern(entry.Name()) {
			return errors.New(Conf.Language(424))
		}
		directory, pathErr := dataImportDirectory(entry.Name())
		if pathErr != nil {
			return pathErr
		}
		data, readErr := os.ReadFile(filepath.Join(directory, "operation.json"))
		if os.IsNotExist(readErr) {
			continue
		}
		operation := &dataImportOperation{}
		if readErr != nil || json.Unmarshal(data, operation) != nil || operation.Version != 1 ||
			!slices.Contains([]string{"committing", "committed", "rolledback"}, operation.State) {
			return errors.New(Conf.Language(424))
		}
		seen := map[string]bool{}
		for _, file := range operation.Files {
			if !archiveRelativePath(file.Path) || seen[strings.ToLower(file.Path)] || len(file.After.SHA256) != 64 ||
				file.Exists && len(file.Before.SHA256) != 64 {
				return errors.New(Conf.Language(424))
			}
			seen[strings.ToLower(file.Path)] = true
		}
		if operation.State == "committing" {
			if err = rollbackDataImport(directory, operation); err != nil {
				return fmt.Errorf("%s: %w", Conf.Language(424), err)
			}
		}
	}
	return nil
}
