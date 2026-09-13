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
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/88250/gulu"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

const stagedSYImportTTL = 30 * time.Minute

var stagedSYImportLock sync.Mutex

// beginImportUpload 在解析上传数据前显示进度；成功解析的表单由 Gin 缓存，供契约绑定复用。
func beginImportUpload[Data any](c *gin.Context) *apicontract.Response[Data] {
	util.PushEndlessProgress(model.Conf.Language(73))
	if _, err := c.MultipartForm(); err != nil {
		util.ClearPushProgress(100)
		logging.LogErrorf("parse import upload failed: %s", err)
		response := apicontract.Failure[Data](-1, err.Error())
		return &response
	}
	return nil
}

var importSY = contractHandler(apicontract.ImportSY, func(c *gin.Context, request apicontract.ImportSYRequest) apicontract.Response[apicontract.Null] {
	defer util.ClearPushProgress(100)
	writePath, cleanup, err := saveImportUploadFile(c, request.File)
	if err != nil {
		logging.LogErrorf("save import .sy.zip failed: %s", err)
		return apicontract.Failure[apicontract.Null](-1, err.Error())
	}
	defer cleanup()
	err = model.ImportSY(writePath, request.Notebook, request.TargetPath())
	if err != nil {
		return apicontract.Failure[apicontract.Null](-1, err.Error())
	}
	return apicontract.Success(apicontract.Null{})
}, beginImportUpload[apicontract.Null])

var importSYNotebook = contractHandler(apicontract.ImportSYNotebook, func(c *gin.Context, request apicontract.ImportDataRequest) apicontract.Response[apicontract.ImportNotebookData] {
	defer util.ClearPushProgress(100)

	writePath, cleanup, err := saveImportUploadFile(c, request.File)
	if err != nil {
		logging.LogErrorf("save notebook import .sy.zip failed: %s", err)
		return apicontract.Failure[apicontract.ImportNotebookData](-1, err.Error())
	}
	defer cleanup()
	if ids, bundle, bundleErr := model.ImportSYNotebookBundle(writePath); bundle {
		if bundleErr != nil {
			return apicontract.Failure[apicontract.ImportNotebookData](-1, bundleErr.Error())
		}
		boxes, mountErr := mountImportedNotebooks(ids)
		if nil != mountErr {
			return apicontract.Failure[apicontract.ImportNotebookData](-1, mountErr.Error())
		}
		return apicontract.Success(apicontract.ImportedNotebooksResult(importedNotebookContracts(boxes)))
	}

	id, err := model.ImportSYNotebook(writePath)
	if err != nil {
		return apicontract.Failure[apicontract.ImportNotebookData](-1, err.Error())
	}

	existed, err := model.Mount(id)
	if err != nil {
		return apicontract.Failure[apicontract.ImportNotebookData](-1, err.Error())
	}
	box := model.Conf.Box(id)
	if box == nil {
		return apicontract.Failure[apicontract.ImportNotebookData](-1, "opened notebook ["+id+"] not found")
	}

	event := util.NewCmdResult("createnotebook", 0, util.PushModeBroadcast)
	event.Data = map[string]any{"box": box, "existed": existed}
	util.PushEvent(event)
	return apicontract.Success(apicontract.ImportedNotebookResult(notebookContract(box)))
}, beginImportUpload[apicontract.ImportNotebookData])

var importSYAuto = contractHandler(apicontract.ImportSYAuto, func(c *gin.Context, request apicontract.ImportSYRequest) apicontract.Response[apicontract.ImportAutoData] {
	defer util.ClearPushProgress(100)

	writePath, cleanup, err := saveImportUploadFile(c, request.File)
	if err != nil {
		logging.LogErrorf("save automatic import .sy.zip failed: %s", err)
		return apicontract.Failure[apicontract.ImportAutoData](-1, err.Error())
	}
	defer cleanup()
	if ids, bundle, bundleErr := model.ImportSYNotebookBundle(writePath); bundle {
		if bundleErr != nil {
			return apicontract.Failure[apicontract.ImportAutoData](-1, bundleErr.Error())
		}
		boxes, mountErr := mountImportedNotebooks(ids)
		if nil != mountErr {
			return apicontract.Failure[apicontract.ImportAutoData](-1, mountErr.Error())
		}
		return apicontract.Success(apicontract.AutoImportedNotebooks(importedNotebookContracts(boxes)))
	}

	createdBoxID, createdNotebook, err := model.ImportSYAuto(writePath, request.Notebook, request.TargetPath())
	if errors.Is(err, model.ErrSYTargetNotebookRequired) {
		token, stageErr := stageSYImport(writePath)
		if stageErr != nil {
			return apicontract.Failure[apicontract.ImportAutoData](-1, stageErr.Error())
		}
		return apicontract.Success(apicontract.AutoImportedDocument(token))
	}
	if err != nil {
		return apicontract.Failure[apicontract.ImportAutoData](-1, err.Error())
	}

	document := apicontract.AutoImportedDocument("")
	if !createdNotebook {
		return apicontract.Success(document)
	}
	existed, err := model.Mount(createdBoxID)
	if err != nil {
		return apicontract.ImportSYAuto.FailureWithData(-1, err.Error(), document)
	}
	box := model.Conf.Box(createdBoxID)
	if nil == box {
		return apicontract.ImportSYAuto.FailureWithData(-1, "opened notebook ["+createdBoxID+"] not found", document)
	}
	event := util.NewCmdResult("createnotebook", 0, util.PushModeBroadcast)
	event.Data = map[string]any{"box": box, "existed": existed}
	util.PushEvent(event)
	return apicontract.Success(apicontract.AutoImportedNotebook(notebookContract(box)))
}, beginImportUpload[apicontract.ImportAutoData])

func mountImportedNotebooks(ids []string) (ret []*model.Box, err error) {
	for _, id := range ids {
		var existed bool
		existed, err = model.Mount(id)
		if nil != err {
			return
		}
		box := model.Conf.Box(id)
		if nil == box {
			return nil, fmt.Errorf("opened notebook [%s] not found", id)
		}
		ret = append(ret, box)
		event := util.NewCmdResult("createnotebook", 0, util.PushModeBroadcast)
		event.Data = map[string]any{"box": box, "existed": existed}
		util.PushEvent(event)
	}
	return
}

var continueImportSY = contractHandler(apicontract.ContinueImportSY, func(c *gin.Context, request apicontract.ContinueImportSYRequest) apicontract.Response[apicontract.ImportDocumentData] {
	zipPath, err := claimStagedSYImport(request.Token)
	if err != nil {
		return apicontract.Failure[apicontract.ImportDocumentData](-1, err.Error())
	}
	defer os.Remove(zipPath)
	if err = model.ImportSY(zipPath, request.Notebook, "/"); err != nil {
		return apicontract.Failure[apicontract.ImportDocumentData](-1, err.Error())
	}
	return apicontract.Success(apicontract.ImportDocumentData{Type: "document"})
})

var cancelImportSY = contractHandler(apicontract.CancelImportSY, func(c *gin.Context, request apicontract.ImportTokenRequest) apicontract.Response[apicontract.Null] {
	token := request.Token
	if !isValidSYImportToken(token) {
		return apicontract.Failure[apicontract.Null](-1, "invalid import token")
	}
	stagedSYImportLock.Lock()
	defer stagedSYImportLock.Unlock()
	cleanupStagedSYImports()
	if err := os.Remove(stagedSYImportPath(token)); err != nil && !os.IsNotExist(err) {
		return apicontract.Failure[apicontract.Null](-1, err.Error())
	}
	return apicontract.Success(apicontract.Null{})
})

func stageSYImport(srcPath string) (token string, err error) {
	stagedSYImportLock.Lock()
	defer stagedSYImportLock.Unlock()
	cleanupStagedSYImports()
	if err = os.MkdirAll(stagedSYImportDir(), 0755); err != nil {
		return
	}
	for {
		token = gulu.Rand.String(32)
		_, statErr := os.Stat(stagedSYImportPath(token))
		if os.IsNotExist(statErr) {
			break
		}
		if statErr != nil {
			return "", statErr
		}
	}
	err = os.Rename(srcPath, stagedSYImportPath(token))
	return
}

func claimStagedSYImport(token string) (path string, err error) {
	if !isValidSYImportToken(token) {
		return "", errors.New("invalid import token")
	}
	stagedSYImportLock.Lock()
	defer stagedSYImportLock.Unlock()
	cleanupStagedSYImports()
	srcPath := stagedSYImportPath(token)
	if _, err = os.Stat(srcPath); err != nil {
		if os.IsNotExist(err) {
			err = errors.New("import task not found or expired")
		}
		return "", err
	}
	path = filepath.Join(stagedSYImportDir(), token+"-importing.zip")
	err = os.Rename(srcPath, path)
	return
}

func cleanupStagedSYImports() {
	entries, err := os.ReadDir(stagedSYImportDir())
	if err != nil {
		return
	}
	now := time.Now()
	for _, entry := range entries {
		name := entry.Name()
		if !strings.HasSuffix(name, ".zip") || !isValidSYImportToken(strings.TrimSuffix(name, ".zip")) {
			continue
		}
		info, infoErr := entry.Info()
		if infoErr == nil && now.Sub(info.ModTime()) > stagedSYImportTTL {
			_ = os.Remove(filepath.Join(stagedSYImportDir(), name))
		}
	}
}

func stagedSYImportDir() string {
	return filepath.Join(util.TempDir, "import", "sy")
}

func stagedSYImportPath(token string) string {
	return filepath.Join(stagedSYImportDir(), token+".zip")
}

func isValidSYImportToken(token string) bool {
	if len(token) != 32 {
		return false
	}
	for _, char := range token {
		if !(char >= 'a' && char <= 'z') && !(char >= 'A' && char <= 'Z') && !(char >= '0' && char <= '9') {
			return false
		}
	}
	return true
}

func saveImportUploadFile(c *gin.Context, file *multipart.FileHeader) (writePath string, cleanup func(), err error) {
	if file == nil {
		return "", nil, errors.New("no file found")
	}

	importDir := filepath.Join(util.TempDir, "import", gulu.Rand.String(7))
	if err = os.MkdirAll(importDir, 0755); err != nil {
		return
	}
	cleanup = func() { _ = os.RemoveAll(importDir) }
	writePath = filepath.Join(importDir, filepath.Base(file.Filename))
	if !gulu.File.IsSubPath(importDir, writePath) {
		err = errors.New("import path is not sub path of import dir")
		cleanup()
		return
	}

	if err = c.SaveUploadedFile(file, writePath); err != nil {
		cleanup()
	}
	return
}

var importData = contractHandler(apicontract.ImportData, func(c *gin.Context, request apicontract.ImportDataRequest) apicontract.Response[apicontract.Null] {
	defer util.ClearPushProgress(100)
	if request.File == nil {
		return apicontract.Failure[apicontract.Null](-1, "file not found")
	}
	importDir := filepath.Join(util.TempDir, "import")
	err := os.MkdirAll(importDir, 0755)
	if err != nil {
		return apicontract.Failure[apicontract.Null](-1, "create temp import dir failed")
	}
	dataZipPath := filepath.Join(importDir, util.CurrentTimeSecondsStr()+".zip")
	defer os.RemoveAll(dataZipPath)

	var dataZipFile *os.File
	var fileReader io.ReadCloser
	defer func() {
		if dataZipFile != nil {
			_ = dataZipFile.Close()
		}
		if fileReader != nil {
			_ = fileReader.Close()
		}
	}()

	dataZipFile, err = os.Create(dataZipPath)
	if err != nil {
		logging.LogErrorf("create temp file failed: %s", err)
		return apicontract.Failure[apicontract.Null](-1, "create temp file failed")
	}
	file := request.File
	logging.LogInfof("import data [name=%s, size=%d]", file.Filename, file.Size)
	fileReader, err = file.Open()
	if err != nil {
		logging.LogErrorf("open upload file failed: %s", err)
		return apicontract.Failure[apicontract.Null](-1, "open file failed")
	}
	_, err = io.Copy(dataZipFile, fileReader)
	if err != nil {
		logging.LogErrorf("read upload file failed: %s", err)
		return apicontract.Failure[apicontract.Null](-1, "read file failed")
	}
	if err = dataZipFile.Close(); err != nil {
		logging.LogErrorf("close file failed: %s", err)
		return apicontract.Failure[apicontract.Null](-1, "close file failed")
	}
	dataZipFile = nil
	if err = fileReader.Close(); err != nil {
		logging.LogErrorf("close upload reader failed: %s", err)
		return apicontract.Failure[apicontract.Null](-1, "close file failed")
	}
	fileReader = nil

	err = model.ImportData(dataZipPath)
	if err != nil {
		return apicontract.Failure[apicontract.Null](-1, err.Error())
	}
	return apicontract.Success(apicontract.Null{})
}, beginImportUpload[apicontract.Null])

var importStdMd = contractHandler(apicontract.ImportStdMd, func(c *gin.Context, request apicontract.ImportMarkdownRequest) apicontract.Response[apicontract.Null] {
	notebook, localPath, toPath, skipRoot := request.Notebook, request.LocalPath, request.ToPath, request.SkipRoot

	if gulu.File.IsSubPath(util.WorkingDir, localPath) {
		msg := fmt.Sprintf("import from local path [%s] failed: local path is sub path of working dir", localPath)
		logging.LogError(msg)
		return apicontract.Failure[apicontract.Null](-1, msg)
	}

	if util.IsSensitivePath(localPath) {
		msg := fmt.Sprintf("import from local path [%s] failed: local path is sensitive path", localPath)
		logging.LogError(msg)
		return apicontract.Failure[apicontract.Null](-1, msg)
	}

	var err error
	if skipRoot {
		err = model.ImportFromLocalPathSkipRoot(notebook, localPath, toPath)
	} else {
		err = model.ImportFromLocalPath(notebook, localPath, toPath)
	}
	if err != nil {
		return apicontract.Failure[apicontract.Null](-1, err.Error())
	}
	return apicontract.Success(apicontract.Null{})
})

var importZipMd = contractHandler(apicontract.ImportZipMd, func(c *gin.Context, request apicontract.ImportZipMarkdownRequest) apicontract.Response[apicontract.Null] {
	defer util.ClearPushProgress(100)
	file := request.File
	if file == nil {
		return apicontract.Failure[apicontract.Null](-1, "no file found")
	}
	importDir := filepath.Join(util.TempDir, "import")
	var err error
	if err = os.MkdirAll(importDir, 0755); err != nil {
		logging.LogErrorf("make import dir [%s] failed: %s", importDir, err)
		return apicontract.Failure[apicontract.Null](-1, err.Error())
	}

	writePath := filepath.Join(importDir, file.Filename)
	if !gulu.File.IsSubPath(importDir, writePath) {
		logging.LogErrorf("import path [%s] is not sub path of import dir [%s]", writePath, importDir)
		return apicontract.Failure[apicontract.Null](-1, "import path is not sub path of import dir")
	}

	defer os.RemoveAll(writePath)

	var reader io.ReadCloser
	var writer *os.File
	defer func() {
		if writer != nil {
			_ = writer.Close()
		}
		if reader != nil {
			_ = reader.Close()
		}
	}()

	reader, err = file.Open()
	if err != nil {
		logging.LogErrorf("read import .zip failed: %s", err)
		return apicontract.Failure[apicontract.Null](-1, err.Error())
	}

	writer, err = os.OpenFile(writePath, os.O_RDWR|os.O_CREATE, 0644)
	if err != nil {
		logging.LogErrorf("open import .zip [%s] failed: %s", writePath, err)
		return apicontract.Failure[apicontract.Null](-1, err.Error())
	}
	if _, err = io.Copy(writer, reader); err != nil {
		logging.LogErrorf("write import .zip failed: %s", err)
		return apicontract.Failure[apicontract.Null](-1, err.Error())
	}
	if err = writer.Close(); err != nil {
		logging.LogErrorf("close import .zip [%s] failed: %s", writePath, err)
		return apicontract.Failure[apicontract.Null](-1, err.Error())
	}
	writer = nil
	if err = reader.Close(); err != nil {
		logging.LogErrorf("close import upload reader failed: %s", err)
		return apicontract.Failure[apicontract.Null](-1, err.Error())
	}
	reader = nil

	if request.Notebook == nil {
		return apicontract.Failure[apicontract.Null](-1, "Field [notebook] is required")
	}
	if request.ToPath == nil {
		return apicontract.Failure[apicontract.Null](-1, "Field [toPath] is required")
	}
	notebook := *request.Notebook
	toPath := *request.ToPath
	skipRoot := request.SkipRoot == "true"

	// 准备解压路径
	filenameMain := strings.TrimSuffix(file.Filename, filepath.Ext(file.Filename))
	unzipPath := filepath.Join(util.TempDir, "import", filenameMain)

	defer os.RemoveAll(unzipPath)

	// 解压 writePath 的 zip 到 unzipPath
	err = gulu.Zip.Unzip(writePath, unzipPath)
	if err != nil {
		logging.LogErrorf("unzip import .zip failed: %s", err)
		return apicontract.Failure[apicontract.Null](-1, err.Error())
	}

	// 调用本地导入逻辑
	if skipRoot {
		err = model.ImportFromLocalPathSkipRoot(notebook, unzipPath, toPath)
	} else {
		err = model.ImportFromLocalPath(notebook, unzipPath, toPath)
	}

	if err != nil {
		return apicontract.Failure[apicontract.Null](-1, err.Error())
	}
	return apicontract.Success(apicontract.Null{})
}, beginImportUpload[apicontract.Null])

var startObsidianVaultAnalysis = contractHandler(apicontract.StartObsidianVaultAnalysis, func(c *gin.Context, request apicontract.ObsidianAnalysisRequest) apicontract.Response[*apicontract.ObsidianVaultTask] {
	task, err := model.StartObsidianVaultAnalysis(request.LocalPath)
	if err != nil {
		return apicontract.Failure[*apicontract.ObsidianVaultTask](-1, err.Error())
	}
	return apicontract.Success(obsidianTaskContract(task))
})

var getObsidianVaultTask = contractHandler(apicontract.GetObsidianVaultTask, func(c *gin.Context, request apicontract.ObsidianTaskRequest) apicontract.Response[*apicontract.ObsidianVaultTask] {
	ret := gulu.Ret.NewResult()
	if util.InvalidIDPattern(request.TaskID, ret) {
		return contractFailure[*apicontract.ObsidianVaultTask](ret)
	}
	task, err := model.GetObsidianVaultTask(request.TaskID)
	if err != nil {
		return apicontract.Failure[*apicontract.ObsidianVaultTask](-1, err.Error())
	}
	return apicontract.Success(obsidianTaskContract(task))
})

var startObsidianVaultImport = contractHandler(apicontract.StartObsidianVaultImport, func(c *gin.Context, request apicontract.ObsidianImportRequest) apicontract.Response[*apicontract.ObsidianVaultTask] {
	ret := gulu.Ret.NewResult()
	if util.InvalidIDPattern(request.TaskID, ret) {
		return contractFailure[*apicontract.ObsidianVaultTask](ret)
	}
	task, err := model.StartObsidianVaultImport(request.TaskID, request.NotebookName)
	if err != nil {
		return apicontract.Failure[*apicontract.ObsidianVaultTask](-1, err.Error())
	}
	return apicontract.Success(obsidianTaskContract(task))
})

var cancelObsidianVaultTask = contractHandler(apicontract.CancelObsidianVaultTask, func(c *gin.Context, request apicontract.ObsidianTaskRequest) apicontract.Response[*apicontract.ObsidianVaultTask] {
	ret := gulu.Ret.NewResult()
	if util.InvalidIDPattern(request.TaskID, ret) {
		return contractFailure[*apicontract.ObsidianVaultTask](ret)
	}
	task, err := model.CancelObsidianVaultTask(request.TaskID)
	if err != nil {
		return apicontract.CancelObsidianVaultTask.FailureWithData(-1, err.Error(), obsidianTaskContract(task))
	}
	return apicontract.Success(obsidianTaskContract(task))
})

func obsidianTaskContract(task *model.ObsidianVaultTask) *apicontract.ObsidianVaultTask {
	if task == nil {
		return nil
	}
	return &apicontract.ObsidianVaultTask{TaskID: task.TaskID, State: task.State, Progress: task.Progress,
		Message: task.Message, Error: task.Error, Detail: task.Detail,
		Analysis: (*apicontract.ObsidianVaultAnalysis)(task.Analysis), Result: (*apicontract.ObsidianVaultImportResult)(task.Result)}
}

func importedNotebookContracts(boxes []*model.Box) []*apicontract.Notebook {
	if boxes == nil {
		return nil
	}
	result := make([]*apicontract.Notebook, len(boxes))
	for i, box := range boxes {
		result[i] = notebookContract(box)
	}
	return result
}
