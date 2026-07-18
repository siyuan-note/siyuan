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
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/88250/gulu"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

const stagedSYImportTTL = 30 * time.Minute

var stagedSYImportLock sync.Mutex

func importSY(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(200, ret)

	util.PushEndlessProgress(model.Conf.Language(73))
	defer util.ClearPushProgress(100)

	form, writePath, cleanup, err := saveImportUpload(c)
	if err != nil {
		logging.LogErrorf("save import .sy.zip failed: %s", err)
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
	defer cleanup()

	var notebook string
	if values := form.Value["notebook"]; len(values) > 0 {
		notebook = values[0]
	}
	toPath := "/"
	if values := form.Value["toPath"]; len(values) > 0 {
		toPath = values[0]
	}

	err = model.ImportSY(writePath, notebook, toPath)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
}

func importSYNotebook(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	util.PushEndlessProgress(model.Conf.Language(73))
	defer util.ClearPushProgress(100)

	_, writePath, cleanup, err := saveImportUpload(c)
	if err != nil {
		logging.LogErrorf("save notebook import .sy.zip failed: %s", err)
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
	defer cleanup()

	id, err := model.ImportSYNotebook(writePath)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	existed, err := model.Mount(id)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
	box := model.Conf.Box(id)
	if box == nil {
		ret.Code = -1
		ret.Msg = "opened notebook [" + id + "] not found"
		return
	}

	ret.Data = map[string]any{"notebook": box}
	event := util.NewCmdResult("createnotebook", 0, util.PushModeBroadcast)
	event.Data = map[string]any{"box": box, "existed": existed}
	util.PushEvent(event)
}

func importSYAuto(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	util.PushEndlessProgress(model.Conf.Language(73))
	defer util.ClearPushProgress(100)

	form, writePath, cleanup, err := saveImportUpload(c)
	if err != nil {
		logging.LogErrorf("save automatic import .sy.zip failed: %s", err)
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
	defer cleanup()

	var notebook string
	if values := form.Value["notebook"]; len(values) > 0 {
		notebook = values[0]
	}
	toPath := "/"
	if values := form.Value["toPath"]; len(values) > 0 {
		toPath = values[0]
	}
	createdBoxID, createdNotebook, err := model.ImportSYAuto(writePath, notebook, toPath)
	if errors.Is(err, model.ErrSYTargetNotebookRequired) {
		token, stageErr := stageSYImport(writePath)
		if stageErr != nil {
			ret.Code = -1
			ret.Msg = stageErr.Error()
			return
		}
		ret.Data = map[string]any{"type": "document", "token": token}
		return
	}
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	ret.Data = map[string]any{"type": "document"}
	if !createdNotebook {
		return
	}
	existed, err := model.Mount(createdBoxID)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
	box := model.Conf.Box(createdBoxID)
	if nil == box {
		ret.Code = -1
		ret.Msg = "opened notebook [" + createdBoxID + "] not found"
		return
	}
	ret.Data = map[string]any{"type": "notebook", "notebook": box}
	event := util.NewCmdResult("createnotebook", 0, util.PushModeBroadcast)
	event.Data = map[string]any{"box": box, "existed": existed}
	util.PushEvent(event)
}

func continueImportSY(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}
	var token, notebook string
	if !util.ParseJsonArgs(arg, ret,
		util.BindJsonArg("token", &token, true, true),
		util.BindJsonArg("notebook", &notebook, true, true)) {
		return
	}
	zipPath, err := claimStagedSYImport(token)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
	defer os.Remove(zipPath)
	if err = model.ImportSY(zipPath, notebook, "/"); err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
	ret.Data = map[string]any{"type": "document"}
}

func cancelImportSY(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}
	var token string
	if !util.ParseJsonArgs(arg, ret, util.BindJsonArg("token", &token, true, true)) {
		return
	}
	if !isValidSYImportToken(token) {
		ret.Code = -1
		ret.Msg = "invalid import token"
		return
	}
	stagedSYImportLock.Lock()
	defer stagedSYImportLock.Unlock()
	cleanupStagedSYImports()
	if err := os.Remove(stagedSYImportPath(token)); err != nil && !os.IsNotExist(err) {
		ret.Code = -1
		ret.Msg = err.Error()
	}
}

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

func saveImportUpload(c *gin.Context) (form *multipart.Form, writePath string, cleanup func(), err error) {
	form, err = c.MultipartForm()
	if err != nil {
		return
	}
	files := form.File["file"]
	if len(files) < 1 {
		err = errors.New("no file found")
		return
	}

	importDir := filepath.Join(util.TempDir, "import", gulu.Rand.String(7))
	if err = os.MkdirAll(importDir, 0755); err != nil {
		return
	}
	cleanup = func() { _ = os.RemoveAll(importDir) }
	writePath = filepath.Join(importDir, filepath.Base(files[0].Filename))
	if !gulu.File.IsSubPath(importDir, writePath) {
		err = errors.New("import path is not sub path of import dir")
		cleanup()
		return
	}

	if err = c.SaveUploadedFile(files[0], writePath); err != nil {
		cleanup()
	}
	return
}

func importData(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	util.PushEndlessProgress(model.Conf.Language(73))
	defer util.ClearPushProgress(100)

	form, err := c.MultipartForm()
	if err != nil {
		logging.LogErrorf("import data failed: %s", err)
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	if 1 > len(form.File["file"]) {
		logging.LogErrorf("import data failed: %s", err)
		ret.Code = -1
		ret.Msg = "file not found"
		return
	}

	importDir := filepath.Join(util.TempDir, "import")
	err = os.MkdirAll(importDir, 0755)
	if err != nil {
		ret.Code = -1
		ret.Msg = "create temp import dir failed"
		return
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
		ret.Code = -1
		ret.Msg = "create temp file failed"
		return
	}
	file := form.File["file"][0]
	logging.LogInfof("import data [name=%s, size=%d]", file.Filename, file.Size)
	fileReader, err = file.Open()
	if err != nil {
		logging.LogErrorf("open upload file failed: %s", err)
		ret.Code = -1
		ret.Msg = "open file failed"
		return
	}
	_, err = io.Copy(dataZipFile, fileReader)
	if err != nil {
		logging.LogErrorf("read upload file failed: %s", err)
		ret.Code = -1
		ret.Msg = "read file failed"
		return
	}
	if err = dataZipFile.Close(); err != nil {
		logging.LogErrorf("close file failed: %s", err)
		ret.Code = -1
		ret.Msg = "close file failed"
		return
	}
	dataZipFile = nil
	if err = fileReader.Close(); err != nil {
		logging.LogErrorf("close upload reader failed: %s", err)
		ret.Code = -1
		ret.Msg = "close file failed"
		return
	}
	fileReader = nil

	err = model.ImportData(dataZipPath)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
}

func importStdMd(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	notebook := arg["notebook"].(string)
	localPath := arg["localPath"].(string)
	toPath := arg["toPath"].(string)

	if gulu.File.IsSubPath(util.WorkingDir, localPath) {
		msg := fmt.Sprintf("import from local path [%s] failed: local path is sub path of working dir", localPath)
		logging.LogError(msg)
		ret.Code = -1
		ret.Msg = msg
		return
	}

	if util.IsSensitivePath(localPath) {
		msg := fmt.Sprintf("import from local path [%s] failed: local path is sensitive path", localPath)
		logging.LogError(msg)
		ret.Code = -1
		ret.Msg = msg
		return
	}

	err := model.ImportFromLocalPath(notebook, localPath, toPath)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
}

func importZipMd(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(200, ret)

	util.PushEndlessProgress(model.Conf.Language(73))
	defer util.ClearPushProgress(100)

	form, err := c.MultipartForm()
	if err != nil {
		logging.LogErrorf("parse import .zip failed: %s", err)
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	files := form.File["file"]
	if 1 > len(files) {
		logging.LogErrorf("parse import .zip failed, no file found")
		ret.Code = -1
		ret.Msg = "no file found"
		return
	}
	file := files[0]
	importDir := filepath.Join(util.TempDir, "import")
	if err = os.MkdirAll(importDir, 0755); err != nil {
		logging.LogErrorf("make import dir [%s] failed: %s", importDir, err)
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	writePath := filepath.Join(importDir, file.Filename)
	if !gulu.File.IsSubPath(importDir, writePath) {
		logging.LogErrorf("import path [%s] is not sub path of import dir [%s]", writePath, importDir)
		ret.Code = -1
		ret.Msg = "import path is not sub path of import dir"
		return
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
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	writer, err = os.OpenFile(writePath, os.O_RDWR|os.O_CREATE, 0644)
	if err != nil {
		logging.LogErrorf("open import .zip [%s] failed: %s", writePath, err)
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
	if _, err = io.Copy(writer, reader); err != nil {
		logging.LogErrorf("write import .zip failed: %s", err)
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
	if err = writer.Close(); err != nil {
		logging.LogErrorf("close import .zip [%s] failed: %s", writePath, err)
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
	writer = nil
	if err = reader.Close(); err != nil {
		logging.LogErrorf("close import upload reader failed: %s", err)
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
	reader = nil

	notebook := form.Value["notebook"][0]
	toPath := form.Value["toPath"][0]

	// 准备解压路径
	filenameMain := strings.TrimSuffix(file.Filename, filepath.Ext(file.Filename))
	unzipPath := filepath.Join(util.TempDir, "import", filenameMain)

	defer os.RemoveAll(unzipPath)

	// 解压 writePath 的 zip 到 unzipPath
	err = gulu.Zip.Unzip(writePath, unzipPath)
	if err != nil {
		logging.LogErrorf("unzip import .zip failed: %s", err)
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	// 调用本地导入逻辑
	err = model.ImportFromLocalPath(notebook, unzipPath, toPath)

	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
}

func startObsidianVaultAnalysis(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}
	var localPath string
	if !util.ParseJsonArgs(arg, ret, util.BindJsonArg("localPath", &localPath, true, true)) {
		return
	}
	task, err := model.StartObsidianVaultAnalysis(localPath)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
	ret.Data = task
}

func getObsidianVaultTask(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}
	var taskID string
	if !util.ParseJsonArgs(arg, ret, util.BindJsonArg("taskID", &taskID, true, true)) || util.InvalidIDPattern(taskID, ret) {
		return
	}
	task, err := model.GetObsidianVaultTask(taskID)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
	ret.Data = task
}

func startObsidianVaultImport(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}
	var taskID, notebookName string
	if !util.ParseJsonArgs(arg, ret,
		util.BindJsonArg("taskID", &taskID, true, true),
		util.BindJsonArg("notebookName", &notebookName, true, true)) || util.InvalidIDPattern(taskID, ret) {
		return
	}
	task, err := model.StartObsidianVaultImport(taskID, notebookName)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
	ret.Data = task
}

func cancelObsidianVaultTask(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}
	var taskID string
	if !util.ParseJsonArgs(arg, ret, util.BindJsonArg("taskID", &taskID, true, true)) || util.InvalidIDPattern(taskID, ret) {
		return
	}
	task, err := model.CancelObsidianVaultTask(taskID)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		ret.Data = task
		return
	}
	ret.Data = task
}
