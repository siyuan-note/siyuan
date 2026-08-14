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
	"bytes"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/88250/gulu"
	"github.com/imroc/req/v3"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/httpclient"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/util"
	"golang.org/x/sync/singleflight"
)

var downloadPackageFlight singleflight.Group
var bazaarDownloadCloudServer = util.GetCloudServer

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
func InstallPackage(repoURL, repoHash, installPath, systemID, pkgType, packageName string, update bool) error {
	var fallbackInstallTime time.Time
	if update {
		if info, statErr := os.Stat(installPath); statErr == nil {
			fallbackInstallTime = info.ModTime()
		}
	}

	repoURLHash := repoURL + "@" + repoHash
	data, err := downloadBazaarFile(repoURLHash, true)
	if err != nil {
		return err
	}
	if err = installPackage(data, installPath, pkgType, packageName, update); err != nil {
		return err
	}
	RemoveInstalledPackageSizeCache(pkgType, packageName)

	// 记录首次安装时间或最近更新时间
	now := time.Now()
	recordPackageOperationTime(pkgType, packageName, now, fallbackInstallTime, update)

	// 文件夹的修改时间设置为当前操作时间
	if err = os.Chtimes(installPath, now, now); err != nil {
		logging.LogWarnf("set package [%s] folder mtime failed: %s", packageName, err)
	}

	go incPackageDownloads(repoURL, packageName, systemID)
	return nil
}

func installPackage(data []byte, installPath, pkgType, packageName string, update bool) (err error) {
	// 非更新安装时目标目录已存在且非空则拒绝覆盖，防止把其他包的内容写入已有包目录
	// https://github.com/siyuan-note/siyuan/security/advisories/GHSA-rpx2-p6hp-x5gj
	if !update {
		entries, statErr := os.ReadDir(installPath)
		if statErr != nil && !os.IsNotExist(statErr) {
			return statErr
		}
		if 0 < len(entries) {
			return errors.New("marketplace package install path already exists")
		}
	}

	tmpPackage := filepath.Join(util.TempDir, "bazaar", "package")
	if err = os.MkdirAll(tmpPackage, 0755); err != nil {
		return
	}
	name := gulu.Rand.String(7)
	tmp := filepath.Join(tmpPackage, name+".zip")
	defer os.RemoveAll(tmp)
	if err = os.WriteFile(tmp, data, 0644); err != nil {
		return
	}

	unzipPath := filepath.Join(tmpPackage, name)
	defer os.RemoveAll(unzipPath)
	if err = gulu.Zip.Unzip(tmp, unzipPath); err != nil {
		logging.LogErrorf("write file [%s] failed: %s", installPath, err)
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
		return errors.New("invalid marketplace package type")
	}
	pkg, parseErr := ParsePackageJSON(filepath.Join(srcPath, jsonFileName))
	if parseErr != nil || nil == pkg {
		return errors.New("marketplace package manifest not found or invalid")
	}
	if packageName != pkg.Name {
		return fmt.Errorf("marketplace package name mismatch: expected [%s], got [%s]", packageName, pkg.Name)
	}

	if err = filelock.Copy(srcPath, installPath); err != nil {
		return
	}
	return
}

// InstallLocalPackage 从已解压并验证的目录安装本地集市包。
func InstallLocalPackage(sourcePath, installPath, pkgType, packageName string, update bool) (err error) {
	if err = os.MkdirAll(filepath.Dir(installPath), 0755); err != nil {
		return
	}

	var fallbackInstallTime time.Time
	if info, statErr := os.Stat(installPath); statErr == nil {
		fallbackInstallTime = info.ModTime()
	}
	operationPath := filepath.Join(filepath.Dir(installPath), ".siyuan-package-install-"+gulu.Rand.String(7))
	stagingPath := filepath.Join(operationPath, "staging")
	backupPath := filepath.Join(operationPath, "backup")
	preserveOperationPath := false
	defer func() {
		if !preserveOperationPath {
			_ = os.RemoveAll(operationPath)
		}
	}()
	if err = filelock.Copy(sourcePath, stagingPath); err != nil {
		return
	}

	if update {
		if err = os.Rename(installPath, backupPath); err != nil {
			return
		}
	}
	if err = os.Rename(stagingPath, installPath); err != nil {
		if update {
			if rollbackErr := os.Rename(backupPath, installPath); rollbackErr != nil {
				preserveOperationPath = true
				return fmt.Errorf("install local marketplace package failed: %w; rollback failed: %s", err, rollbackErr)
			}
		}
		return
	}
	if update {
		if removeErr := os.RemoveAll(operationPath); removeErr != nil {
			logging.LogWarnf("remove local package backup [%s] failed: %s", backupPath, removeErr)
		}
	}

	RemoveInstalledPackageSizeCache(pkgType, packageName)
	now := time.Now()
	recordPackageOperationTime(pkgType, packageName, now, fallbackInstallTime, update)
	if chtimesErr := os.Chtimes(installPath, now, now); chtimesErr != nil {
		logging.LogWarnf("set package [%s] folder mtime failed: %s", packageName, chtimesErr)
	}
	return
}

// UninstallPackage 卸载集市包
func UninstallPackage(installPath string) (err error) {
	if err = os.RemoveAll(installPath); err != nil {
		logging.LogErrorf("remove [%s] failed: %s", installPath, err)
		return fmt.Errorf("remove community package [%s] failed", filepath.Base(installPath))
	}
	return
}
