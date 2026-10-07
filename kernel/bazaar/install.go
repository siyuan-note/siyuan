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

package bazaar

import (
	"archive/zip"
	"bytes"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/imroc/req/v3"
	"github.com/siyuan-note/httpclient"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/util"
	"golang.org/x/sync/singleflight"
)

var downloadPackageFlight singleflight.Group
var bazaarDownloadCloudServer = util.GetCloudServer
var packageInstallLock sync.Mutex

// downloadBazaarFile 下载集市文件
func downloadBazaarFile(repoURLHash string, pushProgress bool) (data []byte, err error) {
	repoURLHashTrimmed := strings.TrimPrefix(repoURLHash, "https://github.com/")
	v, err, _ := downloadPackageFlight.Do(repoURLHash, func() (any, error) {
		// repoURLHash: https://github.com/88250/Comfortably-Numb@6286912c381ef3f83e455d06ba4d369c498238dc 或带路径 /README.md
		repoURL := repoURLHash[:strings.LastIndex(repoURLHash, "@")]
		u := util.BazaarOSSServer + "/package/" + repoURLHashTrimmed
		buf := &bytes.Buffer{}
		resp, err := httpclient.NewCloudFileRequest2m().SetOutput(buf).SetDownloadCallback(func(info req.DownloadInfo) {
			if pushProgress {
				progress := float32(info.DownloadedSize) / float32(info.Response.ContentLength)
				util.PushDownloadProgress(repoURL, progress)
			}
		}).Get(u)
		if err != nil {
			logging.LogErrorf("get bazaar package [%s] failed: %s", u, err)
			return nil, errors.New("get bazaar package failed, please check your network")
		}
		if 200 != resp.StatusCode {
			logging.LogErrorf("get bazaar package [%s] failed: %d", u, resp.StatusCode)
			return nil, errors.New("get bazaar package failed: " + resp.Status)
		}
		data := buf.Bytes()
		return data, nil
	})
	if err != nil {
		return nil, err
	}
	return v.([]byte), nil
}

// incPackageDownloads 增加集市包下载次数
func incPackageDownloads(repoURL, packageName, systemID string) {
	if "" == systemID {
		return
	}
	repo := strings.TrimPrefix(repoURL, "https://github.com/")
	u := bazaarDownloadCloudServer() + "/apis/siyuan/bazaar/addBazaarPackageDownloadCount"
	httpclient.NewCloudRequest30s().SetBody(
		map[string]any{
			"systemID":    systemID,
			"repo":        repo,
			"packageName": packageName,
		}).Post(u)
}

// packageManifestNames 各类型集市包清单文件名
var packageManifestNames = func() map[string]string {
	// localPackageManifests 是清单文件名到包类型的映射，这里反转出包类型到清单文件名的映射
	names := make(map[string]string, len(localPackageManifests))
	for manifest, pkgType := range localPackageManifests {
		names[pkgType] = manifest
	}
	return names
}()

// InstallPackage 安装集市包
func InstallPackage(repoURL, repoHash, repoRef, installPath, systemID, pkgType, packageName string, update bool) error {
	_, err := InstallPackageWithOptions(repoURL, repoHash, repoRef, installPath, systemID, pkgType, packageName, update, PackageInstallOptions{})
	return err
}

// InstallPackageWithOptions 将在线包替换也纳入目标版本校验。
func InstallPackageWithOptions(repoURL, repoHash, repoRef, installPath, systemID, pkgType, packageName string, update bool, options PackageInstallOptions) (*PackageInstallResult, error) {
	if options.ExpectedInstalledRevision == "" {
		revision, err := InstalledPackageRevision(installPath)
		if err != nil {
			return nil, err
		}
		options.ExpectedInstalledRevision = revision
	}
	var fallbackInstallTime time.Time
	if update {
		if info, statErr := os.Stat(installPath); statErr == nil {
			fallbackInstallTime = info.ModTime()
		}
	}

	repoURLHash := repoURL + "@" + repoHash
	data, err := downloadBazaarFile(repoURLHash, true)
	if err != nil {
		return nil, err
	}
	result, err := installPackageWithOptions(data, installPath, pkgType, packageName, update, options)
	if err != nil {
		return nil, err
	}
	RemoveInstalledPackageSizeCache(pkgType, packageName)

	// 记录首次安装时间或最近更新时间
	now := time.Now()
	recordPackageOperationTime(pkgType, packageName, now, fallbackInstallTime, update, repoURL, repoRef)

	// 文件夹的修改时间设置为当前操作时间
	if err = os.Chtimes(installPath, now, now); err != nil {
		logging.LogWarnf("set package [%s] folder mtime failed: %s", packageName, err)
	}

	go incPackageDownloads(repoURL, packageName, systemID)
	return result, nil
}

func installPackage(data []byte, installPath, pkgType, packageName string, update bool) error {
	_, err := installPackageWithOptions(data, installPath, pkgType, packageName, update, PackageInstallOptions{})
	return err
}

func installPackageWithOptions(data []byte, installPath, pkgType, packageName string, update bool, options PackageInstallOptions) (result *PackageInstallResult, err error) {
	// 非更新安装时目标目录已存在且非空则拒绝覆盖，防止把其他包的内容写入已有包目录
	// https://github.com/siyuan-note/siyuan/security/advisories/GHSA-rpx2-p6hp-x5gj
	if !update {
		containsFile, statErr := PackageDirContainsFile(installPath)
		if statErr != nil && !os.IsNotExist(statErr) {
			return nil, statErr
		}
		if containsFile {
			return nil, errors.New("marketplace package install path already exists")
		}
	}

	tmpPackage := filepath.Join(util.TempDir, "bazaar", "package")
	if options.PrivateTemp {
		tmpPackage = filepath.Join(installPrivateRoot(), "install-operations")
		if err = makePrivateInstallDir(tmpPackage); err != nil {
			return
		}
	} else if err = os.MkdirAll(tmpPackage, 0755); err != nil {
		return
	}
	unzipPath, err := os.MkdirTemp(tmpPackage, "online-")
	if err != nil {
		return
	}
	defer os.RemoveAll(unzipPath)
	reader, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return
	}
	if err = extractLocalPackageReader(reader, unzipPath); err != nil {
		return
	}

	dirs, err := os.ReadDir(unzipPath)
	if err != nil {
		return
	}

	srcPath := unzipPath
	if 1 == len(dirs) && dirs[0].IsDir() {
		srcPath = filepath.Join(unzipPath, dirs[0].Name())
	}

	// 校验下载包自身声明的名称与请求安装的包名一致，防止把其他包的内容写入指定目录
	// https://github.com/siyuan-note/siyuan/security/advisories/GHSA-rpx2-p6hp-x5gj
	jsonFileName, ok := packageManifestNames[pkgType]
	if !ok {
		return nil, errors.New("invalid marketplace package type")
	}
	manifestData, readErr := os.ReadFile(filepath.Join(srcPath, jsonFileName))
	if readErr != nil {
		return nil, errors.New("marketplace package manifest not found or invalid")
	}
	pkg, parseErr := parseInstallPackageManifest(manifestData)
	if parseErr != nil || nil == pkg {
		return nil, errors.New("marketplace package manifest not found or invalid")
	}
	if packageName != pkg.Name {
		return nil, fmt.Errorf("marketplace package name mismatch: expected [%s], got [%s]", packageName, pkg.Name)
	}

	if result, err = replacePackageDirectoryWithOptions(srcPath, installPath, update, options); err != nil {
		return
	}
	return
}

// replacePackageDirectory 将 sourcePath 整目录替换到 installPath。
// 先拷到安装目录同级的 staging，更新时再把旧目录 rename 成 backup，最后把 staging rename 成目标路径。
// 这样新包已删除的文件不会残留，失败时也可以把 backup rename 回去。
func replacePackageDirectory(sourcePath, installPath string, update bool) error {
	_, err := replacePackageDirectoryWithOptions(sourcePath, installPath, update, PackageInstallOptions{})
	return err
}

func replacePackageDirectoryWithOptions(sourcePath, installPath string, update bool, options PackageInstallOptions) (result *PackageInstallResult, err error) {
	packageInstallLock.Lock()
	defer packageInstallLock.Unlock()
	if err = validateInstalledRevision(options.ExpectedInstalledRevision); err != nil {
		return
	}
	if err = rejectInstallPathLinks(installPath); err != nil {
		return
	}
	previousRevision, err := installedPackageRevision(installPath)
	if err != nil {
		return nil, err
	}
	if options.ExpectedInstalledRevision != "" && previousRevision != options.ExpectedInstalledRevision {
		return nil, ErrInstalledRevisionConflict
	}
	containsFile, statErr := PackageDirContainsFile(installPath)
	targetExists := statErr == nil
	if statErr != nil && !os.IsNotExist(statErr) {
		return nil, statErr
	}
	if targetExists && !update && containsFile {
		return nil, errors.New("marketplace package install path already exists")
	}
	if update && !targetExists {
		return nil, os.ErrNotExist
	}
	result = &PackageInstallResult{PreviousRevision: previousRevision}
	if err = os.MkdirAll(filepath.Dir(installPath), 0755); err != nil {
		return
	}
	operationPath, err := os.MkdirTemp(filepath.Dir(installPath), ".siyuan-package-install-")
	if err != nil {
		return result, err
	}
	stagingPath := filepath.Join(operationPath, "staging")
	backupPath := filepath.Join(operationPath, "backup")
	preserveOperationPath := false
	defer func() {
		if !preserveOperationPath {
			_ = os.RemoveAll(operationPath)
		}
	}()
	copiedRevision, err := copyInstallTree(sourcePath, stagingPath)
	if err != nil {
		return result, err
	}
	sourceRevision, err := installedPackageRevision(sourcePath)
	if err != nil {
		return result, err
	}
	stagingRevision, err := installedPackageRevision(stagingPath)
	if err != nil {
		return result, err
	}
	if sourceRevision != copiedRevision || stagingRevision != copiedRevision {
		return result, ErrInstalledRevisionConflict
	}
	currentRevision, err := installedPackageRevision(installPath)
	if err != nil {
		return result, err
	}
	if currentRevision != previousRevision {
		return result, ErrInstalledRevisionConflict
	}
	if options.BeforeReplace != nil {
		if err = options.BeforeReplace(); err != nil {
			return
		}
	}
	// 回调和复制均结束后再复核，线上与本地安装共享这一个实际替换段。
	currentRevision, err = installedPackageRevision(installPath)
	if err != nil {
		return result, err
	}
	if currentRevision != previousRevision {
		return result, ErrInstalledRevisionConflict
	}
	finalStagingRevision, err := installedPackageRevision(stagingPath)
	if err != nil {
		return result, err
	}
	if finalStagingRevision != stagingRevision {
		return result, ErrInstalledRevisionConflict
	}
	if targetExists {
		if err = os.Rename(installPath, backupPath); err != nil {
			return
		}
	}
	if err = os.Rename(stagingPath, installPath); err != nil {
		if targetExists {
			if rollbackErr := os.Rename(backupPath, installPath); rollbackErr != nil {
				preserveOperationPath = true
				return result, fmt.Errorf("result_unknown: install marketplace package failed: %w; rollback failed: %s", err, rollbackErr)
			}
		}
		return
	}
	result.InstalledRevision, err = installedPackageRevision(installPath)
	if err != nil || result.InstalledRevision != stagingRevision {
		preserveOperationPath = true
		return result, errors.New("result_unknown: installed package changed after replacement; recovery copy preserved")
	}
	return
}

// InstallLocalPackage 从已解压并验证的目录安装本地集市包。
func InstallLocalPackage(sourcePath, installPath, pkgType, packageName string, update bool) error {
	_, err := InstallLocalPackageWithOptions(sourcePath, installPath, pkgType, packageName, update, PackageInstallOptions{})
	return err
}

func InstallLocalPackageWithOptions(sourcePath, installPath, pkgType, packageName string, update bool, options PackageInstallOptions) (result *PackageInstallResult, err error) {
	var fallbackInstallTime time.Time
	if info, statErr := os.Stat(installPath); statErr == nil {
		fallbackInstallTime = info.ModTime()
	}
	if result, err = replacePackageDirectoryWithOptions(sourcePath, installPath, update, options); err != nil {
		return
	}

	RemoveInstalledPackageSizeCache(pkgType, packageName)
	now := time.Now()
	recordPackageOperationTime(pkgType, packageName, now, fallbackInstallTime, update, "", "")
	if chtimesErr := os.Chtimes(installPath, now, now); chtimesErr != nil {
		logging.LogWarnf("set package [%s] folder mtime failed: %s", packageName, chtimesErr)
	}
	return
}

// UninstallPackage 卸载集市包
func UninstallPackage(installPath string) (err error) {
	packageInstallLock.Lock()
	defer packageInstallLock.Unlock()

	if err = os.RemoveAll(installPath); err != nil {
		logging.LogErrorf("remove [%s] failed: %s", installPath, err)
		return fmt.Errorf("remove community package [%s] failed", filepath.Base(installPath))
	}
	return
}
