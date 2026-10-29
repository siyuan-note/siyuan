// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package bazaar

import (
	"archive/zip"
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/imroc/req/v3"
	"github.com/siyuan-note/httpclient"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/util"
	"golang.org/x/sync/semaphore"
	"golang.org/x/sync/singleflight"
)

var downloadPackageFlight singleflight.Group
var bazaarDownloadCloudServer = util.GetCloudServer
var bazaarDownloadFileServer = util.BazaarOSSServer
var packageInstallLock = semaphore.NewWeighted(1)

// downloadBazaarFile 下载集市文件
func downloadBazaarFile(repoURLHash string, pushProgress bool) (data []byte, err error) {
	v, err, _ := downloadPackageFlight.Do(repoURLHash, func() (any, error) {
		return downloadBazaarFileContext(context.Background(), repoURLHash, pushProgress)
	})
	if err != nil {
		return nil, err
	}
	return v.([]byte), nil
}

// downloadBazaarFileContext 为每次安装独立下载，避免取消一个请求影响其他安装或 README 请求。
func downloadBazaarFileContext(ctx context.Context, repoURLHash string, pushProgress bool) ([]byte, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	repoURL := repoURLHash[:strings.LastIndex(repoURLHash, "@")]
	u := bazaarDownloadFileServer + "/package/" + strings.TrimPrefix(repoURLHash, "https://github.com/")
	buf := &bytes.Buffer{}
	resp, err := httpclient.NewCloudFileRequest2m().SetContext(ctx).SetOutput(buf).SetDownloadCallback(func(info req.DownloadInfo) {
		if pushProgress && ctx.Err() == nil && info.Response.ContentLength > 0 {
			// 完整响应校验成功后才推送完成，避免提前禁用取消操作。
			progress := min(float32(info.DownloadedSize)/float32(info.Response.ContentLength), 0.99)
			util.PushDownloadProgress(repoURL, progress)
		}
	}).Get(u)
	if ctx.Err() != nil {
		return nil, ctx.Err()
	}
	if err != nil {
		logging.LogErrorf("get bazaar package [%s] failed: %s", u, err)
		return nil, errors.New("get bazaar package failed, please check your network")
	}
	if 200 != resp.StatusCode {
		logging.LogErrorf("get bazaar package [%s] failed: %d", u, resp.StatusCode)
		return nil, errors.New("get bazaar package failed: " + resp.Status)
	}
	if pushProgress {
		util.PushDownloadProgress(repoURL, 1)
	}
	return buf.Bytes(), nil
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

// InstallPackageWithOptions 将在线包替换也纳入目标版本校验。
func InstallPackageWithOptions(repoURL, repoHash, repoRef, installPath, systemID, pkgType, packageName string, update bool, options PackageInstallOptions) (*PackageInstallResult, error) {
	if err := options.check(); err != nil {
		return nil, err
	}
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
	data, err := downloadBazaarFileContext(options.context(), repoURLHash, true)
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
	if err = options.check(); err != nil {
		return
	}
	layout, ok := GetPackageLayout(pkgType)
	if !ok {
		return nil, errors.New("invalid marketplace package type")
	}
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
	reader, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return
	}
	// 先在 temp 中解压并完成归档、路径和包名校验，data 下只接收已通过校验的内容
	unpackPath, err := makePackageExtractionDir("package", "online-")
	if err != nil {
		return
	}
	defer os.RemoveAll(unpackPath)
	if err = extractLocalPackageReaderContext(options.context(), reader, unpackPath); err != nil {
		return
	}
	sourcePath, err := localPackageRoot(unpackPath)
	if err != nil {
		return
	}
	// 校验下载包自身声明的名称与请求安装的包名一致，防止把其他包的内容写入指定目录
	// https://github.com/siyuan-note/siyuan/security/advisories/GHSA-rpx2-p6hp-x5gj
	if err = validateInstallPackageManifest(sourcePath, layout.Manifest, packageName); err != nil {
		return
	}
	return replacePackageDirectoryWithOptions(sourcePath, installPath, update, options)
}

// validateInstallPackageManifest 校验包目录的清单声明与请求安装的包名一致。
func validateInstallPackageManifest(sourcePath, manifestName, packageName string) error {
	manifestData, err := os.ReadFile(filepath.Join(sourcePath, manifestName))
	if err != nil {
		return errors.New("marketplace package manifest not found or invalid")
	}
	pkg, err := parseInstallPackageManifest(manifestData)
	if err != nil || nil == pkg {
		return errors.New("marketplace package manifest not found or invalid")
	}
	if packageName != pkg.Name {
		return fmt.Errorf("marketplace package name mismatch: expected [%s], got [%s]", packageName, pkg.Name)
	}
	return nil
}

// replacePackageDirectory 将 sourcePath 整目录替换到 installPath。
// 先拷到安装目录同级的 staging，更新时再把旧目录 rename 成 backup，最后把 staging rename 成目标路径。
// 这样新包已删除的文件不会残留，失败时也可以把 backup rename 回去。
func replacePackageDirectory(sourcePath, installPath string, update bool) error {
	_, err := replacePackageDirectoryWithOptions(sourcePath, installPath, update, PackageInstallOptions{})
	return err
}

// replacePackageDirectoryWithOptions 在安装锁外复制并核对 staging，锁内只做目标摘要校验与提交替换。
func replacePackageDirectoryWithOptions(sourcePath, installPath string, update bool, options PackageInstallOptions) (result *PackageInstallResult, err error) {
	if err = options.check(); err != nil {
		return nil, err
	}
	if err = validateInstalledRevision(options.ExpectedInstalledRevision); err != nil {
		return
	}
	// 复制前固定目标版本；即使调用方未显式绑定版本，也不能覆盖复制期间发生的编辑或安装。
	previousRevision, err := lockedInstalledPackageRevision(options.context(), installPath)
	if err != nil {
		return nil, err
	}
	if options.ExpectedInstalledRevision != "" && previousRevision != options.ExpectedInstalledRevision {
		return nil, ErrInstalledRevisionConflict
	}
	if err = os.MkdirAll(filepath.Dir(installPath), 0755); err != nil {
		return
	}
	operationPath, err := os.MkdirTemp(filepath.Dir(installPath), ".siyuan-package-install-")
	if err != nil {
		return nil, err
	}
	stagingPath := filepath.Join(operationPath, "staging")
	backupPath := filepath.Join(operationPath, "backup")
	preserveOperationPath := false
	defer func() {
		if !preserveOperationPath {
			_ = os.RemoveAll(operationPath)
		}
	}()
	copiedRevision, err := copyInstallTree(options.context(), sourcePath, stagingPath)
	if err != nil {
		return nil, err
	}
	// staging 位于本次操作独有的目录，锁外即可核对复制结果，失败也在进入临界区前返回
	stagingRevision, err := installedPackageRevision(stagingPath)
	if err != nil {
		return nil, err
	}
	if stagingRevision == MissingInstalledRevision {
		return nil, errors.New("marketplace package staging content is missing")
	}
	if copiedRevision != stagingRevision {
		return nil, ErrInstalledRevisionConflict
	}
	if err = options.check(); err != nil {
		return nil, err
	}

	if err = packageInstallLock.Acquire(options.context(), 1); err != nil {
		return nil, err
	}
	defer packageInstallLock.Release(1)
	if err = options.check(); err != nil {
		return nil, err
	}
	if err = rejectInstallPathLinks(installPath); err != nil {
		return nil, err
	}
	currentRevision, err := installedPackageRevision(installPath)
	if err != nil {
		return nil, err
	}
	if currentRevision != previousRevision {
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
	if options.BeforeReplace != nil {
		if err = options.BeforeReplace(); err != nil {
			return result, err
		}
		// 回调是锁内唯一执行外部代码的位置，只有存在回调时才复核两侧内容未被改动
		if err = verifyInstallRevisions(installPath, previousRevision, stagingPath, stagingRevision); err != nil {
			return result, err
		}
	}
	// 最后一次取消和授权检查紧邻提交点；开始替换后必须完成提交或回滚并返回真实结果。
	if err = options.check(); err != nil {
		return result, err
	}
	if targetExists {
		retrying := false
		if err = renamePackageDirectoryWithRetry(installPath, backupPath, func(source, target string) error {
			if retrying {
				if checkErr := options.check(); checkErr != nil {
					return checkErr
				}
				if checkErr := verifyInstallRevisions(installPath, previousRevision, stagingPath, stagingRevision); checkErr != nil {
					return checkErr
				}
			}
			retrying = true
			return os.Rename(source, target)
		}); err != nil {
			return
		}
	}
	if err = renamePackageDirectory(stagingPath, installPath); err != nil {
		if targetExists {
			if rollbackErr := renamePackageDirectory(backupPath, installPath); rollbackErr != nil {
				preserveOperationPath = true
				return result, util.NewTextFileError(util.TextFileResultUnknown, fmt.Errorf("install marketplace package failed: %w; rollback failed: %s", err, rollbackErr))
			}
		}
		return
	}
	result.InstalledRevision, err = installedPackageRevision(installPath)
	if err != nil || result.InstalledRevision != stagingRevision {
		preserveOperationPath = true
		return result, util.NewTextFileError(util.TextFileResultUnknown, errors.New("installed package changed after replacement; recovery copy preserved"))
	}
	return
}

// verifyInstallRevisions 复核回调前后安装目标与 staging 的摘要都未变化。
func verifyInstallRevisions(installPath, installRevision, stagingPath, stagingRevision string) error {
	current, err := installedPackageRevision(installPath)
	if err != nil {
		return err
	}
	if current != installRevision {
		return ErrInstalledRevisionConflict
	}
	current, err = installedPackageRevision(stagingPath)
	if err != nil {
		return err
	}
	if current != stagingRevision {
		return ErrInstalledRevisionConflict
	}
	return nil
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
	if err = packageInstallLock.Acquire(context.Background(), 1); err != nil {
		return err
	}
	defer packageInstallLock.Release(1)

	if err = os.RemoveAll(installPath); err != nil {
		logging.LogErrorf("remove [%s] failed: %s", installPath, err)
		return fmt.Errorf("remove community package [%s] failed", filepath.Base(installPath))
	}
	return
}
