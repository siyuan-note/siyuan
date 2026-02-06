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

	"github.com/88250/gulu"
	"github.com/imroc/req/v3"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/httpclient"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/util"
	"golang.org/x/sync/singleflight"
)

var downloadPackageFlight singleflight.Group

// downloadBazaarFile 下载集市文件
func downloadBazaarFile(repoURLHash string, pushProgress bool) (data []byte, err error) {
	repoURLHashTrimmed := strings.TrimPrefix(repoURLHash, "https://github.com/")
	v, err, _ := downloadPackageFlight.Do(repoURLHash, func() (interface{}, error) {
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
func incPackageDownloads(repoURL, systemID string) {
	if "" == systemID {
		return
	}
	repo := strings.TrimPrefix(repoURL, "https://github.com/")
	u := util.GetCloudServer() + "/apis/siyuan/bazaar/addBazaarPackageDownloadCount"
	httpclient.NewCloudRequest30s().SetBody(
		map[string]interface{}{
			"systemID": systemID,
			"repo":     repo,
		}).Post(u)
}

// InstallPackage 安装集市包
func InstallPackage(repoURL, repoHash, installPath, systemID string) error {
	repoURLHash := repoURL + "@" + repoHash
	data, err := downloadBazaarFile(repoURLHash, true)
	if err != nil {
		return err
	}
	if err = installPackage(data, installPath); err != nil {
		return err
	}
	go incPackageDownloads(repoURL, systemID)
	return nil
}

func installPackage(data []byte, installPath string) (err error) {
	tmpPackage := filepath.Join(util.TempDir, "bazaar", "package")
	if err = os.MkdirAll(tmpPackage, 0755); err != nil {
		return
	}
	name := gulu.Rand.String(7)
	tmp := filepath.Join(tmpPackage, name+".zip")
	if err = os.WriteFile(tmp, data, 0644); err != nil {
		return
	}

	unzipPath := filepath.Join(tmpPackage, name)
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

	if err = filelock.Copy(srcPath, installPath); err != nil {
		return
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
