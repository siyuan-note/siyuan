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

package api

import (
	"encoding/hex"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/siyuan-note/logging"

	"github.com/88250/gulu"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func importSyncProviderWebDAV(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(200, ret)

	form, err := c.MultipartForm()
	if nil != err {
		logging.LogErrorf("read upload file failed: %s", err)
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	files := form.File["file"]
	if 1 != len(files) {
		ret.Code = -1
		ret.Msg = "invalid upload file"
		return
	}

	f := files[0]
	fh, err := f.Open()
	if nil != err {
		logging.LogErrorf("read upload file failed: %s", err)
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	data, err := io.ReadAll(fh)
	fh.Close()
	if nil != err {
		logging.LogErrorf("read upload file failed: %s", err)
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	tmpDir := filepath.Join(util.TempDir, "import")
	if err = os.MkdirAll(tmpDir, 0755); nil != err {
		logging.LogErrorf("import WebDAV provider failed: %s", err)
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	tmp := filepath.Join(tmpDir, f.Filename)
	if err = os.WriteFile(tmp, data, 0644); nil != err {
		logging.LogErrorf("import WebDAV provider failed: %s", err)
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	if err = gulu.Zip.Unzip(tmp, tmpDir); nil != err {
		logging.LogErrorf("import WebDAV provider failed: %s", err)
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	tmp = filepath.Join(tmpDir, f.Filename[:len(f.Filename)-4])
	data, err = os.ReadFile(tmp)
	if nil != err {
		logging.LogErrorf("import WebDAV provider failed: %s", err)
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	data = util.AESDecrypt(string(data))
	data, _ = hex.DecodeString(string(data))
	webdav := &conf.WebDAV{}
	if err = gulu.JSON.UnmarshalJSON(data, webdav); nil != err {
		logging.LogErrorf("import WebDAV provider failed: %s", err)
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	err = model.SetSyncProviderWebDAV(webdav)
	if nil != err {
		logging.LogErrorf("import WebDAV provider failed: %s", err)
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	ret.Data = map[string]interface{}{
		"webdav": model.Conf.Sync.WebDAV,
	}
}

func exportSyncProviderWebDAV(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	name := "siyuan-webdav-" + time.Now().Format("20060102150405") + ".json"
	tmpDir := filepath.Join(util.TempDir, "export")
	if err := os.MkdirAll(tmpDir, 0755); nil != err {
		logging.LogErrorf("export WebDAV provider failed: %s", err)
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	webdav := model.Conf.Sync.WebDAV
	if nil == webdav {
		webdav = &conf.WebDAV{}
	}

	data, err := gulu.JSON.MarshalJSON(model.Conf.Sync.WebDAV)
	if nil != err {
		logging.LogErrorf("export WebDAV provider failed: %s", err)
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	dataStr := util.AESEncrypt(string(data))
	tmp := filepath.Join(tmpDir, name)
	if err = os.WriteFile(tmp, []byte(dataStr), 0644); nil != err {
		logging.LogErrorf("export WebDAV provider failed: %s", err)
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	zipFile, err := gulu.Zip.Create(tmp + ".zip")
	if nil != err {
		logging.LogErrorf("export WebDAV provider failed: %s", err)
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	if err = zipFile.AddEntry(name, tmp); nil != err {
		logging.LogErrorf("export WebDAV provider failed: %s", err)
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	if err = zipFile.Close(); nil != err {
		logging.LogErrorf("export WebDAV provider failed: %s", err)
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	zipPath := "/export/" + name + ".zip"
	ret.Data = map[string]interface{}{
		"name": name,
		"zip":  zipPath,
	}
}

func importSyncProviderS3(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(200, ret)

	form, err := c.MultipartForm()
	if nil != err {
		logging.LogErrorf("read upload file failed: %s", err)
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	files := form.File["file"]
	if 1 != len(files) {
		ret.Code = -1
		ret.Msg = "invalid upload file"
		return
	}

	f := files[0]
	fh, err := f.Open()
	if nil != err {
		logging.LogErrorf("read upload file failed: %s", err)
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	data, err := io.ReadAll(fh)
	fh.Close()
	if nil != err {
		logging.LogErrorf("read upload file failed: %s", err)
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	importDir := filepath.Join(util.TempDir, "import")
	if err = os.MkdirAll(importDir, 0755); nil != err {
		logging.LogErrorf("import S3 provider failed: %s", err)
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	tmp := filepath.Join(importDir, f.Filename)
	if err = os.WriteFile(tmp, data, 0644); nil != err {
		logging.LogErrorf("import S3 provider failed: %s", err)
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	tmpDir := filepath.Join(importDir, "s3")
	if err = gulu.Zip.Unzip(tmp, tmpDir); nil != err {
		logging.LogErrorf("import S3 provider failed: %s", err)
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	entries, err := os.ReadDir(tmpDir)
	if nil != err {
		logging.LogErrorf("import S3 provider failed: %s", err)
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	if 1 != len(entries) {
		logging.LogErrorf("invalid S3 provider package")
		ret.Code = -1
		ret.Msg = "invalid S3 provider package"
		return
	}

	tmp = filepath.Join(tmpDir, entries[0].Name())
	data, err = os.ReadFile(tmp)
	if nil != err {
		logging.LogErrorf("import S3 provider failed: %s", err)
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	data = util.AESDecrypt(string(data))
	data, _ = hex.DecodeString(string(data))
	s3 := &conf.S3{}
	if err = gulu.JSON.UnmarshalJSON(data, s3); nil != err {
		logging.LogErrorf("import S3 provider failed: %s", err)
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	err = model.SetSyncProviderS3(s3)
	if nil != err {
		logging.LogErrorf("import S3 provider failed: %s", err)
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	ret.Data = map[string]interface{}{
		"s3": model.Conf.Sync.S3,
	}
}

func exportSyncProviderS3(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	name := "siyuan-s3-" + time.Now().Format("20060102150405") + ".json"
	tmpDir := filepath.Join(util.TempDir, "export")
	if err := os.MkdirAll(tmpDir, 0755); nil != err {
		logging.LogErrorf("export S3 provider failed: %s", err)
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	s3 := model.Conf.Sync.S3
	if nil == s3 {
		s3 = &conf.S3{}
	}

	data, err := gulu.JSON.MarshalJSON(model.Conf.Sync.S3)
	if nil != err {
		logging.LogErrorf("export S3 provider failed: %s", err)
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	dataStr := util.AESEncrypt(string(data))
	tmp := filepath.Join(tmpDir, name)
	if err = os.WriteFile(tmp, []byte(dataStr), 0644); nil != err {
		logging.LogErrorf("export S3 provider failed: %s", err)
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	zipFile, err := gulu.Zip.Create(tmp + ".zip")
	if nil != err {
		logging.LogErrorf("export S3 provider failed: %s", err)
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	if err = zipFile.AddEntry(name, tmp); nil != err {
		logging.LogErrorf("export S3 provider failed: %s", err)
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	if err = zipFile.Close(); nil != err {
		logging.LogErrorf("export S3 provider failed: %s", err)
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	zipPath := "/export/" + name + ".zip"
	ret.Data = map[string]interface{}{
		"name": name,
		"zip":  zipPath,
	}
}

func getSyncInfo(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	stat := model.Conf.Sync.Stat
	if !model.Conf.Sync.Enabled {
		stat = model.Conf.Language(53)
	}

	ret.Data = map[string]interface{}{
		"synced":  model.Conf.Sync.Synced,
		"stat":    stat,
		"kernels": model.GetOnlineKernels(),
		"kernel":  model.KernelID,
	}
}

func getBootSync(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	if !model.IsAdminRoleContext(c) {
		return
	}

	if model.Conf.Sync.Enabled && 1 == model.BootSyncSucc {
		ret.Code = 1
		ret.Msg = model.Conf.Language(17)
		return
	}
}

func performSync(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	// Android 端前后台切换时自动触发同步 https://github.com/siyuan-note/siyuan/issues/7122
	var mobileSwitch bool
	if mobileSwitchArg := arg["mobileSwitch"]; nil != mobileSwitchArg {
		mobileSwitch = mobileSwitchArg.(bool)
	}
	if mobileSwitch {
		if nil == model.Conf.GetUser() || !model.Conf.Sync.Enabled {
			return
		}
	}

	if 3 != model.Conf.Sync.Mode {
		model.SyncData(true)
		return
	}

	// 云端同步模式支持 `完全手动同步` 模式 https://github.com/siyuan-note/siyuan/issues/7295
	uploadArg := arg["upload"]
	if nil == uploadArg {
		// 必须传入同步方向，未传的话不执行同步
		return
	}

	upload := uploadArg.(bool)
	if upload {
		model.SyncDataUpload()
	} else {
		model.SyncDataDownload()
	}
}

func performBootSync(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)
	model.BootSyncData()
	ret.Code = model.BootSyncSucc
}

func listCloudSyncDir(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	syncDirs, hSize, err := model.ListCloudSyncDir()
	if nil != err {
		ret.Code = 1
		ret.Msg = err.Error()
		ret.Data = map[string]interface{}{"closeTimeout": 5000}
		return
	}

	ret.Data = map[string]interface{}{
		"syncDirs":       syncDirs,
		"hSize":          hSize,
		"checkedSyncDir": model.Conf.Sync.CloudName,
	}
}

func removeCloudSyncDir(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	name := arg["name"].(string)
	err := model.RemoveCloudSyncDir(name)
	if nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		ret.Data = map[string]interface{}{"closeTimeout": 5000}
		return
	}

	ret.Data = model.Conf.Sync.CloudName
}

func createCloudSyncDir(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	name := arg["name"].(string)
	err := model.CreateCloudSyncDir(name)
	if nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		ret.Data = map[string]interface{}{"closeTimeout": 5000}
		return
	}
}

func setSyncGenerateConflictDoc(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	enabled := arg["enabled"].(bool)
	model.SetSyncGenerateConflictDoc(enabled)
}

func setSyncEnable(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	enabled := arg["enabled"].(bool)
	model.SetSyncEnable(enabled)
}

func setSyncPerception(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	enabled := arg["enabled"].(bool)
	model.SetSyncPerception(enabled)
}

func setSyncMode(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	mode := int(arg["mode"].(float64))
	model.SetSyncMode(mode)
}

func setSyncProvider(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	provider := int(arg["provider"].(float64))
	err := model.SetSyncProvider(provider)
	if nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		ret.Data = map[string]interface{}{"closeTimeout": 5000}
		return
	}
}

func setSyncProviderS3(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	s3Arg := arg["s3"].(interface{})
	data, err := gulu.JSON.MarshalJSON(s3Arg)
	if nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		ret.Data = map[string]interface{}{"closeTimeout": 5000}
		return
	}

	s3 := &conf.S3{}
	if err = gulu.JSON.UnmarshalJSON(data, s3); nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		ret.Data = map[string]interface{}{"closeTimeout": 5000}
		return
	}

	err = model.SetSyncProviderS3(s3)
	if nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		ret.Data = map[string]interface{}{"closeTimeout": 5000}
		return
	}
}

func setSyncProviderWebDAV(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	webdavArg := arg["webdav"].(interface{})
	data, err := gulu.JSON.MarshalJSON(webdavArg)
	if nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		ret.Data = map[string]interface{}{"closeTimeout": 5000}
		return
	}

	webdav := &conf.WebDAV{}
	if err = gulu.JSON.UnmarshalJSON(data, webdav); nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		ret.Data = map[string]interface{}{"closeTimeout": 5000}
		return
	}

	err = model.SetSyncProviderWebDAV(webdav)
	if nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		ret.Data = map[string]interface{}{"closeTimeout": 5000}
		return
	}
}

func setCloudSyncDir(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	name := arg["name"].(string)
	model.SetCloudSyncDir(name)
}
