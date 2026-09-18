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

package api

import (
	"encoding/hex"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/siyuan-note/dejavu/cloud"
	"github.com/siyuan-note/logging"

	"github.com/88250/gulu"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var importSyncProviderWebDAV = contractHandler(apicontract.ImportSyncProviderWebDAV, importSyncProviderWebDAVContract, prepareSyncProviderImport[apicontract.SyncWebDAVData])

func prepareSyncProviderImport[Data any](c *gin.Context) *apicontract.Response[Data] {
	form, err := c.MultipartForm()
	if err != nil {
		logging.LogErrorf("read upload file failed: %s", err)
		response := apicontract.Failure[Data](-1, err.Error())
		return &response
	}
	if len(form.File["file"]) != 1 {
		response := apicontract.Failure[Data](-1, "invalid upload file")
		return &response
	}
	return nil
}

func importSyncProviderWebDAVContract(c *gin.Context, request apicontract.SyncProviderImportRequest) (ret apicontract.Response[apicontract.SyncWebDAVData]) {

	f := request.File
	fh, err := f.Open()
	if err != nil {
		logging.LogErrorf("read upload file failed: %s", err)
		ret = apicontract.Failure[apicontract.SyncWebDAVData](-1, err.Error())
		return
	}

	data, err := io.ReadAll(fh)
	fh.Close()
	if err != nil {
		logging.LogErrorf("read upload file failed: %s", err)
		ret = apicontract.Failure[apicontract.SyncWebDAVData](-1, err.Error())
		return
	}

	importDir := filepath.Join(util.TempDir, "import")
	if err = os.MkdirAll(importDir, 0755); err != nil {
		logging.LogErrorf("import WebDAV provider failed: %s", err)
		ret = apicontract.Failure[apicontract.SyncWebDAVData](-1, err.Error())
		return
	}

	writePath := filepath.Join(importDir, f.Filename)
	if !gulu.File.IsSubPath(importDir, writePath) {
		logging.LogErrorf("import path [%s] is not sub path of import dir [%s]", writePath, importDir)
		ret = apicontract.Failure[apicontract.SyncWebDAVData](-1, "import path is not sub path of import dir")
		return
	}

	if err = os.WriteFile(writePath, data, 0644); err != nil {
		logging.LogErrorf("import WebDAV provider failed: %s", err)
		ret = apicontract.Failure[apicontract.SyncWebDAVData](-1, err.Error())
		return
	}

	tmpDir := filepath.Join(importDir, "webdav")
	os.RemoveAll(tmpDir)
	var copyError error
	if strings.HasSuffix(strings.ToLower(writePath), ".zip") {
		if err = gulu.Zip.Unzip(writePath, tmpDir); err != nil {
			logging.LogErrorf("import WebDAV provider failed: %s", err)
			ret = apicontract.Failure[apicontract.SyncWebDAVData](-1, err.Error())
			return
		}
	} else if strings.HasSuffix(strings.ToLower(writePath), ".json") {
		if err = gulu.File.CopyFile(writePath, filepath.Join(tmpDir, f.Filename)); err != nil {
			logging.LogErrorf("import WebDAV provider failed: %s", err)
			copyError = err
		}
	} else {
		logging.LogErrorf("invalid WebDAV provider package")
		ret = apicontract.Failure[apicontract.SyncWebDAVData](-1, "invalid WebDAV provider package")
		return
	}

	entries, err := os.ReadDir(tmpDir)
	if err != nil {
		logging.LogErrorf("import WebDAV provider failed: %s", err)
		ret = apicontract.Failure[apicontract.SyncWebDAVData](-1, err.Error())
		return
	}

	if 1 != len(entries) {
		logging.LogErrorf("invalid WebDAV provider package")
		ret = apicontract.Failure[apicontract.SyncWebDAVData](-1, "invalid WebDAV provider package")
		return
	}

	writePath = filepath.Join(tmpDir, entries[0].Name())
	data, err = os.ReadFile(writePath)
	if err != nil {
		logging.LogErrorf("import WebDAV provider failed: %s", err)
		ret = apicontract.Failure[apicontract.SyncWebDAVData](-1, err.Error())
		return
	}

	data = util.AESDecrypt(string(data))
	data, _ = hex.DecodeString(string(data))
	webdav := &conf.WebDAV{}
	if err = gulu.JSON.UnmarshalJSON(data, webdav); err != nil {
		logging.LogErrorf("import WebDAV provider failed: %s", err)
		ret = apicontract.Failure[apicontract.SyncWebDAVData](-1, err.Error())
		return
	}

	err = model.SetSyncProviderWebDAV(webdav)
	if err != nil {
		logging.LogErrorf("import WebDAV provider failed: %s", err)
		ret = apicontract.Failure[apicontract.SyncWebDAVData](-1, err.Error())
		return
	}

	result := apicontract.SyncWebDAVData{WebDAV: (*apicontract.SyncWebDAV)(model.Conf.Sync.WebDAV)}
	if copyError != nil {
		return apicontract.ImportSyncProviderWebDAV.FailureWithData(-1, copyError.Error(), result)
	}
	ret = apicontract.Success(result)
	return
}

var exportSyncProviderWebDAV = contractHandler(apicontract.ExportSyncProviderWebDAV, exportSyncProviderWebDAVContract)

func exportSyncProviderWebDAVContract(c *gin.Context, request apicontract.EmptyRequest) (ret apicontract.Response[apicontract.SyncProviderExportData]) {

	name := "siyuan-webdav-" + time.Now().Format("20060102150405") + ".json"
	tmpDir := filepath.Join(util.TempDir, "export")
	if err := os.MkdirAll(tmpDir, 0755); err != nil {
		logging.LogErrorf("export WebDAV provider failed: %s", err)
		ret = apicontract.Failure[apicontract.SyncProviderExportData](-1, err.Error())
		return
	}

	webdav := model.Conf.Sync.WebDAV
	if nil == webdav {
		webdav = &conf.WebDAV{}
	}

	data, err := gulu.JSON.MarshalJSON(model.Conf.Sync.WebDAV)
	if err != nil {
		logging.LogErrorf("export WebDAV provider failed: %s", err)
		ret = apicontract.Failure[apicontract.SyncProviderExportData](-1, err.Error())
		return
	}

	dataStr := util.AESEncrypt(string(data))
	tmp := filepath.Join(tmpDir, name)
	if err = os.WriteFile(tmp, []byte(dataStr), 0644); err != nil {
		logging.LogErrorf("export WebDAV provider failed: %s", err)
		ret = apicontract.Failure[apicontract.SyncProviderExportData](-1, err.Error())
		return
	}

	zipFile, err := gulu.Zip.Create(tmp + ".zip")
	if err != nil {
		logging.LogErrorf("export WebDAV provider failed: %s", err)
		ret = apicontract.Failure[apicontract.SyncProviderExportData](-1, err.Error())
		return
	}

	if err = zipFile.AddEntry(name, tmp); err != nil {
		logging.LogErrorf("export WebDAV provider failed: %s", err)
		ret = apicontract.Failure[apicontract.SyncProviderExportData](-1, err.Error())
		return
	}

	if err = zipFile.Close(); err != nil {
		logging.LogErrorf("export WebDAV provider failed: %s", err)
		ret = apicontract.Failure[apicontract.SyncProviderExportData](-1, err.Error())
		return
	}

	zipPath := "/export/" + name + ".zip"
	ret = apicontract.Success(apicontract.SyncProviderExportData{Name: name, Zip: zipPath})
	return
}

var importSyncProviderS3 = contractHandler(apicontract.ImportSyncProviderS3, importSyncProviderS3Contract, prepareSyncProviderImport[apicontract.SyncS3Data])

func importSyncProviderS3Contract(c *gin.Context, request apicontract.SyncProviderImportRequest) (ret apicontract.Response[apicontract.SyncS3Data]) {

	f := request.File
	fh, err := f.Open()
	if err != nil {
		logging.LogErrorf("read upload file failed: %s", err)
		ret = apicontract.Failure[apicontract.SyncS3Data](-1, err.Error())
		return
	}

	data, err := io.ReadAll(fh)
	fh.Close()
	if err != nil {
		logging.LogErrorf("read upload file failed: %s", err)
		ret = apicontract.Failure[apicontract.SyncS3Data](-1, err.Error())
		return
	}

	importDir := filepath.Join(util.TempDir, "import")
	if err = os.MkdirAll(importDir, 0755); err != nil {
		logging.LogErrorf("import S3 provider failed: %s", err)
		ret = apicontract.Failure[apicontract.SyncS3Data](-1, err.Error())
		return
	}

	writePath := filepath.Join(importDir, f.Filename)
	if !gulu.File.IsSubPath(importDir, writePath) {
		logging.LogErrorf("import path [%s] is not sub path of import dir [%s]", writePath, importDir)
		ret = apicontract.Failure[apicontract.SyncS3Data](-1, "import path is not sub path of import dir")
		return
	}

	if err = os.WriteFile(writePath, data, 0644); err != nil {
		logging.LogErrorf("import S3 provider failed: %s", err)
		ret = apicontract.Failure[apicontract.SyncS3Data](-1, err.Error())
		return
	}

	tmpDir := filepath.Join(importDir, "s3")
	os.RemoveAll(tmpDir)
	var copyError error
	if strings.HasSuffix(strings.ToLower(writePath), ".zip") {
		if err = gulu.Zip.Unzip(writePath, tmpDir); err != nil {
			logging.LogErrorf("import S3 provider failed: %s", err)
			ret = apicontract.Failure[apicontract.SyncS3Data](-1, err.Error())
			return
		}
	} else if strings.HasSuffix(strings.ToLower(writePath), ".json") {
		if err = gulu.File.CopyFile(writePath, filepath.Join(tmpDir, f.Filename)); err != nil {
			logging.LogErrorf("import S3 provider failed: %s", err)
			copyError = err
		}
	} else {
		logging.LogErrorf("invalid S3 provider package")
		ret = apicontract.Failure[apicontract.SyncS3Data](-1, "invalid S3 provider package")
		return
	}

	entries, err := os.ReadDir(tmpDir)
	if err != nil {
		logging.LogErrorf("import S3 provider failed: %s", err)
		ret = apicontract.Failure[apicontract.SyncS3Data](-1, err.Error())
		return
	}

	if 1 != len(entries) {
		logging.LogErrorf("invalid S3 provider package")
		ret = apicontract.Failure[apicontract.SyncS3Data](-1, "invalid S3 provider package")
		return
	}

	writePath = filepath.Join(tmpDir, entries[0].Name())
	data, err = os.ReadFile(writePath)
	if err != nil {
		logging.LogErrorf("import S3 provider failed: %s", err)
		ret = apicontract.Failure[apicontract.SyncS3Data](-1, err.Error())
		return
	}

	data = util.AESDecrypt(string(data))
	data, _ = hex.DecodeString(string(data))
	s3 := &conf.S3{}
	if err = gulu.JSON.UnmarshalJSON(data, s3); err != nil {
		logging.LogErrorf("import S3 provider failed: %s", err)
		ret = apicontract.Failure[apicontract.SyncS3Data](-1, err.Error())
		return
	}

	err = model.SetSyncProviderS3(s3)
	if err != nil {
		logging.LogErrorf("import S3 provider failed: %s", err)
		ret = apicontract.Failure[apicontract.SyncS3Data](-1, err.Error())
		return
	}

	result := apicontract.SyncS3Data{S3: (*apicontract.SyncS3)(model.Conf.Sync.S3)}
	if copyError != nil {
		return apicontract.ImportSyncProviderS3.FailureWithData(-1, copyError.Error(), result)
	}
	ret = apicontract.Success(result)
	return
}

var exportSyncProviderS3 = contractHandler(apicontract.ExportSyncProviderS3, exportSyncProviderS3Contract)

func exportSyncProviderS3Contract(c *gin.Context, request apicontract.EmptyRequest) (ret apicontract.Response[apicontract.SyncProviderExportData]) {

	name := "siyuan-s3-" + time.Now().Format("20060102150405") + ".json"
	tmpDir := filepath.Join(util.TempDir, "export")
	if err := os.MkdirAll(tmpDir, 0755); err != nil {
		logging.LogErrorf("export S3 provider failed: %s", err)
		ret = apicontract.Failure[apicontract.SyncProviderExportData](-1, err.Error())
		return
	}

	s3 := model.Conf.Sync.S3
	if nil == s3 {
		s3 = &conf.S3{}
	}

	data, err := gulu.JSON.MarshalJSON(model.Conf.Sync.S3)
	if err != nil {
		logging.LogErrorf("export S3 provider failed: %s", err)
		ret = apicontract.Failure[apicontract.SyncProviderExportData](-1, err.Error())
		return
	}

	dataStr := util.AESEncrypt(string(data))
	tmp := filepath.Join(tmpDir, name)
	if err = os.WriteFile(tmp, []byte(dataStr), 0644); err != nil {
		logging.LogErrorf("export S3 provider failed: %s", err)
		ret = apicontract.Failure[apicontract.SyncProviderExportData](-1, err.Error())
		return
	}

	zipFile, err := gulu.Zip.Create(tmp + ".zip")
	if err != nil {
		logging.LogErrorf("export S3 provider failed: %s", err)
		ret = apicontract.Failure[apicontract.SyncProviderExportData](-1, err.Error())
		return
	}

	if err = zipFile.AddEntry(name, tmp); err != nil {
		logging.LogErrorf("export S3 provider failed: %s", err)
		ret = apicontract.Failure[apicontract.SyncProviderExportData](-1, err.Error())
		return
	}

	if err = zipFile.Close(); err != nil {
		logging.LogErrorf("export S3 provider failed: %s", err)
		ret = apicontract.Failure[apicontract.SyncProviderExportData](-1, err.Error())
		return
	}

	zipPath := "/export/" + name + ".zip"
	ret = apicontract.Success(apicontract.SyncProviderExportData{Name: name, Zip: zipPath})
	return
}

var getSyncInfo = contractHandler(apicontract.GetSyncInfo, getSyncInfoContract)

func getSyncInfoContract(c *gin.Context, request apicontract.EmptyRequest) (ret apicontract.Response[apicontract.SyncInfoData]) {

	stat := model.Conf.Sync.Stat
	if !model.Conf.Sync.Enabled {
		stat = model.Conf.Language(53)
	}

	kernels := model.GetOnlineKernels()
	items := make([]*apicontract.SyncOnlineKernel, len(kernels))
	for i, item := range kernels {
		items[i] = (*apicontract.SyncOnlineKernel)(item)
	}
	ret = apicontract.Success(apicontract.SyncInfoData{Synced: model.Conf.Sync.Synced, Stat: stat, Kernels: items, Kernel: model.KernelID})
	return
}

var getBootSync = contractHandler(apicontract.GetBootSync, getBootSyncContract)

func getBootSyncContract(c *gin.Context, request apicontract.EmptyRequest) (ret apicontract.Response[apicontract.Null]) {
	ret = apicontract.Success(apicontract.Null{})

	if !model.IsAdminRoleContext(c) {
		return
	}

	if model.Conf.Sync.Enabled && 1 == model.BootSyncSucc {
		ret = apicontract.Failure[apicontract.Null](1, model.Conf.Language(17))
		return
	}
	return
}

var performSync = contractHandler(apicontract.PerformSync, performSyncContract)

func performSyncContract(c *gin.Context, request apicontract.PerformSyncRequest) (ret apicontract.Response[apicontract.Null]) {
	ret = apicontract.Success(apicontract.Null{})

	// Android 端前后台切换时自动触发同步 https://github.com/siyuan-note/siyuan/issues/7122
	mobileSwitch := request.MobileSwitch
	if mobileSwitch {
		if !util.IsBooted() {
			return
		}
		if nil == model.Conf.GetUser() || !model.Conf.Sync.Enabled {
			return
		}
	}

	if 3 != model.Conf.Sync.Mode {
		model.SyncData(true)
		return
	}

	// 云端同步模式支持 `完全手动同步` 模式 https://github.com/siyuan-note/siyuan/issues/7295
	upload, err := request.UploadDirection()
	if err != nil {
		return apicontract.Failure[apicontract.Null](-1, err.Error())
	}
	if upload {
		model.SyncDataUpload()
	} else {
		model.SyncDataDownload()
	}
	return
}

var performBootSync = contractHandler(apicontract.PerformBootSync, performBootSyncContract)

func performBootSyncContract(c *gin.Context, request apicontract.EmptyRequest) (ret apicontract.Response[apicontract.Null]) {
	ret = apicontract.Success(apicontract.Null{})
	model.BootSyncData()
	if model.BootSyncSucc != 0 {
		ret = apicontract.Failure[apicontract.Null](model.BootSyncSucc, "")
	}
	return
}

var listCloudSyncDir = contractHandler(apicontract.ListCloudSyncDir, listCloudSyncDirContract)

func listCloudSyncDirContract(c *gin.Context, request apicontract.EmptyRequest) (ret apicontract.Response[apicontract.CloudSyncDirsData]) {

	syncDirs, hSize, err := model.ListCloudSyncDir()
	if err != nil {
		ret = apicontract.FailureWithTimeout[apicontract.CloudSyncDirsData](1, err.Error(), 5000)
		return
	}

	checkedSyncDir := model.Conf.Sync.CloudName
	if conf.ProviderS3 == model.Conf.Sync.Provider {
		checkedSyncDir = ""
	}
	var items []*apicontract.CloudSyncDir
	if syncDirs != nil {
		items = make([]*apicontract.CloudSyncDir, len(syncDirs))
		for i, item := range syncDirs {
			items[i] = (*apicontract.CloudSyncDir)(item)
		}
	}
	ret = apicontract.Success(apicontract.CloudSyncDirsData{SyncDirs: items, HSize: hSize, CheckedSyncDir: checkedSyncDir})
	return
}

var removeCloudSyncDir = contractHandler(apicontract.RemoveCloudSyncDir, removeCloudSyncDirContract)

func removeCloudSyncDirContract(c *gin.Context, request apicontract.SyncNameRequest) (ret apicontract.Response[string]) {

	name := request.Name
	err := model.RemoveCloudSyncDir(name)
	if err != nil {
		ret = apicontract.FailureWithTimeout[string](-1, err.Error(), 5000)
		return
	}

	ret = apicontract.Success(model.Conf.Sync.CloudName)
	return
}

var createCloudSyncDir = contractHandler(apicontract.CreateCloudSyncDir, createCloudSyncDirContract)

func createCloudSyncDirContract(c *gin.Context, request apicontract.SyncNameRequest) (ret apicontract.Response[apicontract.Null]) {
	ret = apicontract.Success(apicontract.Null{})

	name := request.Name
	err := model.CreateCloudSyncDir(name)
	if err != nil {
		ret = apicontract.FailureWithTimeout[apicontract.Null](-1, err.Error(), 5000)
		return
	}
	return
}

var setSyncGenerateConflictDoc = contractHandler(apicontract.SetSyncGenerateConflictDoc, setSyncGenerateConflictDocContract)

func setSyncGenerateConflictDocContract(c *gin.Context, request apicontract.SyncEnabledRequest) (ret apicontract.Response[apicontract.Null]) {
	ret = apicontract.Success(apicontract.Null{})

	enabled := request.Enabled
	model.SetSyncGenerateConflictDoc(enabled)
	return
}

var setSyncEnable = contractHandler(apicontract.SetSyncEnable, setSyncEnableContract)

func setSyncEnableContract(c *gin.Context, request apicontract.SyncEnabledRequest) (ret apicontract.Response[apicontract.Null]) {
	ret = apicontract.Success(apicontract.Null{})

	enabled := request.Enabled
	model.SetSyncEnable(enabled)
	return
}

var setSyncInterval = contractHandler(apicontract.SetSyncInterval, setSyncIntervalContract)

func setSyncIntervalContract(c *gin.Context, request apicontract.SyncIntervalRequest) (ret apicontract.Response[apicontract.Null]) {
	ret = apicontract.Success(apicontract.Null{})
	interval := request.Interval
	model.SetSyncInterval(int(interval))
	return
}

var setSyncPerception = contractHandler(apicontract.SetSyncPerception, setSyncPerceptionContract)

func setSyncPerceptionContract(c *gin.Context, request apicontract.SyncEnabledRequest) (ret apicontract.Response[apicontract.Null]) {
	ret = apicontract.Success(apicontract.Null{})

	enabled := request.Enabled
	model.SetSyncPerception(enabled)
	return
}

var setSyncLAN = contractHandler(apicontract.SetSyncLAN, setSyncLANContract)

func setSyncLANContract(c *gin.Context, request apicontract.SyncLANRequest) (ret apicontract.Response[apicontract.SyncLANStatus]) {

	enabled, maxConcurrentReqs := request.Enabled, request.MaxConcurrentReqs
	model.SetSyncLAN(enabled, int(maxConcurrentReqs))
	ret = apicontract.Success(apicontract.SyncLANStatus(model.GetSyncLANStatus()))
	return
}

var getSyncLANStatus = contractHandler(apicontract.GetSyncLANStatus, getSyncLANStatusContract)

func getSyncLANStatusContract(c *gin.Context, request apicontract.EmptyRequest) (ret apicontract.Response[apicontract.SyncLANStatus]) {
	ret = apicontract.Success(apicontract.SyncLANStatus(model.GetSyncLANStatus()))
	return
}

var setSyncAssetDownloadMode = contractHandler(apicontract.SetSyncAssetDownloadMode, setSyncAssetDownloadModeContract)

func setSyncAssetDownloadModeContract(c *gin.Context, request apicontract.SyncModeRequest) (ret apicontract.Response[apicontract.SyncAssetDownloadModeData]) {
	mode := request.Mode
	if mode != 0 && mode != 1 {
		ret = apicontract.Failure[apicontract.SyncAssetDownloadModeData](-1, "invalid asset download mode")
		return
	}
	if err := model.SetSyncAssetDownloadMode(int(mode)); err != nil {
		ret = apicontract.FailureWithTimeout[apicontract.SyncAssetDownloadModeData](-1, err.Error(), 7000)
		return
	}
	ret = apicontract.Success(apicontract.SyncAssetDownloadModeData{AssetDownloadMode: int(mode)})
	return
}

var setSyncMode = contractHandler(apicontract.SetSyncMode, setSyncModeContract)

func setSyncModeContract(c *gin.Context, request apicontract.SyncModeRequest) (ret apicontract.Response[apicontract.Null]) {
	ret = apicontract.Success(apicontract.Null{})

	mode := request.Mode
	model.SetSyncMode(int(mode))
	return
}

var setSyncProvider = contractHandler(apicontract.SetSyncProvider, setSyncProviderContract)

func setSyncProviderContract(c *gin.Context, request apicontract.SyncProviderRequest) (ret apicontract.Response[apicontract.Null]) {
	ret = apicontract.Success(apicontract.Null{})

	provider := request.Provider
	err := model.SetSyncProvider(int(provider), request.CompleteAssets)
	if err != nil {
		ret = apicontract.FailureWithTimeout[apicontract.Null](-1, err.Error(), 5000)
		return
	}
	return
}

var setSyncProviderS3 = contractHandler(apicontract.SetSyncProviderS3, setSyncProviderS3Contract)

func setSyncProviderS3Contract(c *gin.Context, request apicontract.SetSyncS3Request) (ret apicontract.Response[apicontract.SyncS3Data]) {

	if err := request.ConfigError(); err != nil {
		return apicontract.FailureWithTimeout[apicontract.SyncS3Data](-1, err.Error(), 5000)
	}
	s3 := (*conf.S3)(&request.S3)

	newBucket := strings.TrimSpace(s3.Bucket)
	prevBucket := strings.TrimSpace(model.Conf.Sync.S3.Bucket)
	if newBucket != prevBucket && !cloud.IsValidCloudDirName(newBucket) {
		ret = apicontract.FailureWithTimeout[apicontract.SyncS3Data](-1, model.Conf.Language(37), 5000)
		return
	}

	err := model.SetSyncProviderS3(s3)
	if err != nil {
		ret = apicontract.FailureWithTimeout[apicontract.SyncS3Data](-1, err.Error(), 5000)
		return
	}

	ret = apicontract.Success(apicontract.SyncS3Data{S3: (*apicontract.SyncS3)(model.Conf.Sync.S3)})
	return
}

var setSyncProviderWebDAV = contractHandler(apicontract.SetSyncProviderWebDAV, setSyncProviderWebDAVContract)

func setSyncProviderWebDAVContract(c *gin.Context, request apicontract.SetSyncWebDAVRequest) (ret apicontract.Response[apicontract.SyncWebDAVData]) {

	if err := request.ConfigError(); err != nil {
		return apicontract.FailureWithTimeout[apicontract.SyncWebDAVData](-1, err.Error(), 5000)
	}
	webdav := (*conf.WebDAV)(&request.WebDAV)

	err := model.SetSyncProviderWebDAV(webdav)
	if err != nil {
		ret = apicontract.FailureWithTimeout[apicontract.SyncWebDAVData](-1, err.Error(), 5000)
		return
	}

	ret = apicontract.Success(apicontract.SyncWebDAVData{WebDAV: (*apicontract.SyncWebDAV)(model.Conf.Sync.WebDAV)})
	return
}

var setSyncProviderLocal = contractHandler(apicontract.SetSyncProviderLocal, setSyncProviderLocalContract)

func setSyncProviderLocalContract(c *gin.Context, request apicontract.SetSyncLocalRequest) (ret apicontract.Response[apicontract.SyncLocalData]) {

	if err := request.ConfigError(); err != nil {
		return apicontract.FailureWithTimeout[apicontract.SyncLocalData](-1, err.Error(), 5000)
	}
	local := (*conf.Local)(&request.Local)

	err := model.SetSyncProviderLocal(local)
	if err != nil {
		ret = apicontract.FailureWithTimeout[apicontract.SyncLocalData](-1, err.Error(), 5000)
		return
	}

	ret = apicontract.Success(apicontract.SyncLocalData{Local: (*apicontract.SyncLocal)(model.Conf.Sync.Local)})
	return
}

var setCloudSyncDir = contractHandler(apicontract.SetCloudSyncDir, setCloudSyncDirContract)

func setCloudSyncDirContract(c *gin.Context, request apicontract.SyncNameRequest) (ret apicontract.Response[apicontract.Null]) {
	ret = apicontract.Success(apicontract.Null{})

	name := request.Name
	if err := model.SetCloudSyncDir(name); err != nil {
		ret = apicontract.Failure[apicontract.Null](-1, err.Error())
	}
	return
}
