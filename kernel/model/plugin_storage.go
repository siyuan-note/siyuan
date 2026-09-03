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
	"errors"
	"fmt"
	"os"
	"path/filepath"

	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/bazaar"
	"github.com/siyuan-note/siyuan/kernel/util"
)

type packageDirContainsFileFunc func(string) (bool, error)

func pluginStoragePath(packageName string) string {
	return filepath.Join(util.DataDir, "storage", "petal", packageName)
}

func setPluginStorageData(pkg *bazaar.Package, packageName string) {
	containsFile, err := bazaar.PackageDirContainsFile(pluginStoragePath(packageName))
	if err != nil {
		if !errors.Is(err, os.ErrNotExist) {
			logging.LogWarnf("read plugin storage directory [%s] failed: %s", pluginStoragePath(packageName), err)
		}
		return
	}
	pkg.HasStorageData = containsFile
}

// CleanupEmptyPluginStorageDirs 在插件加载前清理没有任何文件的插件存储目录。
func CleanupEmptyPluginStorageDirs() {
	if util.ReadOnly {
		return
	}
	storageRoot := filepath.Join(util.DataDir, "storage", "petal")
	if err := cleanupEmptyPluginStorageDirs(storageRoot, bazaar.PackageDirContainsFile); err != nil {
		logging.LogWarnf("cleanup empty plugin storage directories [%s] failed: %s", storageRoot, err)
	}
}

func cleanupEmptyPluginStorageDirs(storageRoot string, containsFile packageDirContainsFileFunc) error {
	rootInfo, err := os.Lstat(storageRoot)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	if rootInfo.Mode()&os.ModeSymlink != 0 || !rootInfo.IsDir() {
		return nil
	}

	entries, err := os.ReadDir(storageRoot)
	if err != nil {
		return err
	}
	var cleanupErrors []error
	for _, entry := range entries {
		isDir, infoErr := isRegularDirectoryEntry(entry)
		if infoErr != nil {
			cleanupErrors = append(cleanupErrors, fmt.Errorf("inspect plugin storage directory [%s]: %w", entry.Name(), infoErr))
			continue
		}
		if !isDir || !bazaar.IsValidPackageName(entry.Name()) {
			continue
		}

		dirPath := filepath.Join(storageRoot, entry.Name())
		hasFile, readErr := containsFile(dirPath)
		if readErr != nil {
			cleanupErrors = append(cleanupErrors, fmt.Errorf("inspect plugin storage directory [%s]: %w", dirPath, readErr))
			continue
		}
		if hasFile {
			continue
		}
		if _, removeErr := removeEmptyDirectoryTree(dirPath); removeErr != nil {
			cleanupErrors = append(cleanupErrors, fmt.Errorf("remove empty plugin storage directory [%s]: %w", dirPath, removeErr))
		}
	}
	return errors.Join(cleanupErrors...)
}

func isRegularDirectoryEntry(entry os.DirEntry) (bool, error) {
	if entry.Type()&os.ModeSymlink != 0 {
		return false, nil
	}
	info, err := entry.Info()
	if err != nil {
		return false, err
	}
	return info.IsDir() && info.Mode()&os.ModeSymlink == 0, nil
}

func removeEmptyDirectoryTree(dirPath string) (removed bool, err error) {
	entries, err := os.ReadDir(dirPath)
	if errors.Is(err, os.ErrNotExist) {
		return true, nil
	}
	if err != nil {
		return false, err
	}
	for _, entry := range entries {
		isDir, infoErr := isRegularDirectoryEntry(entry)
		if infoErr != nil {
			return false, infoErr
		}
		if !isDir {
			return false, nil
		}
		childRemoved, removeErr := removeEmptyDirectoryTree(filepath.Join(dirPath, entry.Name()))
		if removeErr != nil {
			return false, removeErr
		}
		if !childRemoved {
			return false, nil
		}
	}
	if err = os.Remove(dirPath); errors.Is(err, os.ErrNotExist) {
		return true, nil
	}
	if err != nil {
		return false, err
	}
	return true, nil
}
