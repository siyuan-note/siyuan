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
	"io"
	"net/http"
	"os"
	"path/filepath"

	"github.com/88250/gulu"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func importSY(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(200, ret)

	util.PushEndlessProgress(model.Conf.Language(73))
	defer util.ClearPushProgress(100)

	form, err := c.MultipartForm()
	if nil != err {
		logging.LogErrorf("parse import .sy.zip failed: %s", err)
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	files := form.File["file"]
	if 1 > len(files) {
		logging.LogErrorf("parse import .sy.zip failed, no file found")
		ret.Code = -1
		ret.Msg = "no file found"
		return
	}
	file := files[0]
	reader, err := file.Open()
	if nil != err {
		logging.LogErrorf("read import .sy.zip failed: %s", err)
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	importDir := filepath.Join(util.TempDir, "import")
	if err = os.MkdirAll(importDir, 0755); nil != err {
		logging.LogErrorf("make import dir [%s] failed: %s", importDir, err)
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
	writePath := filepath.Join(util.TempDir, "import", file.Filename)
	defer os.RemoveAll(writePath)
	writer, err := os.OpenFile(writePath, os.O_RDWR|os.O_CREATE, 0644)
	if nil != err {
		logging.LogErrorf("open import .sy.zip [%s] failed: %s", writePath, err)
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
	if _, err = io.Copy(writer, reader); nil != err {
		logging.LogErrorf("write import .sy.zip failed: %s", err)
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
	writer.Close()
	reader.Close()

	notebook := form.Value["notebook"][0]
	toPath := form.Value["toPath"][0]

	err = model.ImportSY(writePath, notebook, toPath)
	if nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
}

func importData(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	util.PushEndlessProgress(model.Conf.Language(73))
	defer util.ClearPushProgress(100)

	form, err := c.MultipartForm()
	if nil != err {
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

	tmpImport := filepath.Join(util.TempDir, "import")
	err = os.MkdirAll(tmpImport, 0755)
	if nil != err {
		ret.Code = -1
		ret.Msg = "create temp import dir failed"
		return
	}
	dataZipPath := filepath.Join(tmpImport, util.CurrentTimeSecondsStr()+".zip")
	defer os.RemoveAll(dataZipPath)
	dataZipFile, err := os.Create(dataZipPath)
	if nil != err {
		logging.LogErrorf("create temp file failed: %s", err)
		ret.Code = -1
		ret.Msg = "create temp file failed"
		return
	}
	file := form.File["file"][0]
	fileReader, err := file.Open()
	if nil != err {
		logging.LogErrorf("open upload file failed: %s", err)
		ret.Code = -1
		ret.Msg = "open file failed"
		return
	}
	_, err = io.Copy(dataZipFile, fileReader)
	if nil != err {
		logging.LogErrorf("read upload file failed: %s", err)
		ret.Code = -1
		ret.Msg = "read file failed"
		return
	}
	if err = dataZipFile.Close(); nil != err {
		logging.LogErrorf("close file failed: %s", err)
		ret.Code = -1
		ret.Msg = "close file failed"
		return
	}
	fileReader.Close()

	err = model.ImportData(dataZipPath)
	if nil != err {
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
	err := model.ImportFromLocalPath(notebook, localPath, toPath)
	if nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
}
