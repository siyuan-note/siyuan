// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"errors"
	"os"
	"path/filepath"
	"sync"

	"github.com/siyuan-note/logging"
)

// installPackageFiles 只协调本地安装包的读取、发布和清理，不持有网络下载锁。
var installPackageFiles = struct {
	sync.Mutex
	preservedPath string
}{}

var errInstallPackagePreserved = errors.New("install package is reserved for kernel exit")

// readyInstallPackagePath 仅为真正退出并安装的请求保留安装包，提示和同步失败不保留。
func readyInstallPackagePath(installDir, currentVersion, channel, suffix, key string, preserve bool) string {
	installPackageFiles.Lock()
	defer installPackageFiles.Unlock()
	if _, err := os.Stat(installDir); os.IsNotExist(err) {
		return ""
	}
	lock, err := lockInstallPackageFiles(installDir)
	if err != nil {
		logging.LogWarnf("lock ready install packages failed: %s", err)
		return ""
	}
	defer lock.Close()

	if preserve && installPackageFiles.preservedPath != "" {
		// 宿主重试退出请求时仍使用首次交付的包，保留状态直到内核进程退出。
		recordPath := installPackageFiles.preservedPath + ".json"
		diagnostics := readyInstallPackageDiagnostics{}
		info, err := os.Lstat(recordPath)
		if err == nil && !info.Mode().IsRegular() {
			err = errors.New("install package metadata is not a regular file")
		}
		var metadata *installPackageMetadata
		if err == nil {
			metadata, err = readInstallPackageMetadata(recordPath, key)
		}
		if err != nil {
			logging.LogWarn(diagnostics.rejected(filepath.Base(recordPath), err))
			return ""
		}
		if !readyInstallPackageMatches(metadata, currentVersion, channel, suffix) ||
			filepath.Join(installDir, metadata.FileName) != installPackageFiles.preservedPath {
			return ""
		}
		path, err := verifyInstallPackagePath(installDir, metadata)
		if err != nil {
			logging.LogWarn(diagnostics.rejected(metadata.FileName, err))
		}
		return path
	}

	path := findReadyInstallPackage(installDir, currentVersion, channel, suffix, key)
	if preserve && path != "" {
		if err := reserveSharedInstallPackage(path); err != nil {
			logging.LogWarnf("reserve shared install package failed: %s", err)
			return ""
		}
		installPackageFiles.preservedPath = path
	}
	return path
}

// reuseInstallPackage 与退出选包互斥，不能改写已交付安装包的校验记录。
func reuseInstallPackage(installDir string, metadata *installPackageMetadata, key string) (path string, err error) {
	installPackageFiles.Lock()
	defer installPackageFiles.Unlock()
	lock, err := lockInstallPackageFiles(installDir)
	if err != nil {
		return "", err
	}
	defer lock.Close()

	path = verifiedInstallPackagePath(installDir, metadata)
	if path != "" {
		recordInfo, statErr := os.Lstat(path + ".json")
		stored, readErr := readInstallPackageMetadata(path+".json", key)
		if path != installPackageFiles.preservedPath &&
			(!sharedInstallPackageReserved(path) || statErr != nil || !recordInfo.Mode().IsRegular() ||
				readErr != nil || stored.Checksum != metadata.Checksum) {
			err = saveInstallPackageMetadata(installDir, metadata, key)
		}
		return
	}
	pathToReplace := filepath.Join(installDir, metadata.FileName)
	if pathToReplace == installPackageFiles.preservedPath {
		err = errInstallPackagePreserved
		return
	}
	if sharedInstallPackageReserved(pathToReplace) {
		stored, readErr := readInstallPackageMetadata(pathToReplace+".json", key)
		if readErr == nil && verifiedInstallPackagePath(installDir, stored) != "" {
			// 完整的交付包仍受保护，不能以同名的另一份内容替换。
			return "", errInstallPackagePreserved
		}
		// 损坏或缺失的包无法用于安装，清除交付标记后允许以已认证的校验信息恢复。
		if err = os.Remove(pathToReplace + ".preserve"); os.IsNotExist(err) {
			err = nil
		}
	}
	return
}

// publishInstallPackage 只发布已校验的临时文件，下载中不改写任何就绪安装包。
func publishInstallPackage(temporaryPath, installDir string, metadata *installPackageMetadata, key string) error {
	installPackageFiles.Lock()
	defer installPackageFiles.Unlock()
	lock, err := lockInstallPackageFiles(installDir)
	if err != nil {
		return err
	}
	defer lock.Close()

	path := filepath.Join(installDir, metadata.FileName)
	if path == installPackageFiles.preservedPath || sharedInstallPackageReserved(path) {
		return errInstallPackagePreserved
	}
	if err := os.Rename(temporaryPath, path); err != nil {
		return err
	}
	return saveInstallPackageMetadata(installDir, metadata, key)
}
