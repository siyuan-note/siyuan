// SiYuan - Refactor your thinking
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program. If not, see <https://www.gnu.org/licenses/>.

package model

import (
	"errors"
	"os"
	"path/filepath"
	"strings"

	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// PrepareAssetForOpen 返回可交给系统应用打开的资源绝对路径。
// 加密资源会流式解密到按 box 隔离的临时目录，该目录在笔记本锁定或内核下次启动时清理。
func PrepareAssetForOpen(assetPath string) (ret string, err error) {
	assetAbsPath, err := GetAssetAbsPathInBox(assetPath, "")
	if err != nil {
		return "", err
	}
	if !IsEncryptedAssetPath(assetAbsPath) {
		return assetAbsPath, nil
	}

	boxID := ExtractBoxIDFromAssetsPath(assetAbsPath)
	if err = AcquireEncryptedBoxOperation(boxID); err != nil {
		return "", errors.New(Conf.Language(314))
	}
	defer ReleaseEncryptedBoxOperation(boxID)
	HoldBoxReadLock(boxID)
	defer ReleaseBoxReadLock(boxID)

	dek, err := GetDEKIfUnlocked(boxID)
	if err != nil {
		return "", errors.New(Conf.Language(314))
	}
	defer zeroAndClear(dek)
	if strings.TrimSpace(util.TempDir) == "" {
		return "", errors.New("temporary directory is not initialized")
	}

	openID, err := newManagedEncryptedExportID()
	if err != nil {
		return "", err
	}
	tempDir := filepath.Join(util.TempDir, "export", boxID, "asset-open", openID)
	if err = os.MkdirAll(tempDir, 0700); err != nil {
		return "", err
	}
	cleanup := true
	defer func() {
		if cleanup {
			_ = os.RemoveAll(tempDir)
		}
	}()

	source, err := filelock.OpenFile(assetAbsPath, os.O_RDONLY, 0)
	if err != nil {
		return "", err
	}
	sourceOpen := true
	defer func() {
		if sourceOpen {
			_ = filelock.CloseFile(source)
		}
	}()

	payloadPath := filepath.Join(tempDir, "payload")
	destination, err := os.OpenFile(payloadPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return "", err
	}
	originalName, decryptErr := DecryptAssetToWriter(boxID, filepath.Base(assetAbsPath), dek, source, destination)
	sourceCloseErr := filelock.CloseFile(source)
	sourceOpen = false
	destinationCloseErr := destination.Close()
	if decryptErr != nil {
		return "", decryptErr
	}
	if sourceCloseErr != nil {
		return "", sourceCloseErr
	}
	if destinationCloseErr != nil {
		return "", destinationCloseErr
	}

	originalName = util.FilterFileName(filepath.Base(originalName))
	if originalName == "" || originalName == "." {
		originalName = filepath.Base(assetAbsPath)
	}
	ret = filepath.Join(tempDir, originalName)
	if ret != payloadPath {
		if err = os.Rename(payloadPath, ret); err != nil {
			return "", err
		}
	}
	if err = os.Chmod(ret, 0600); err != nil {
		return "", err
	}
	cleanup = false
	return ret, nil
}
