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
	"net/http"
	"path/filepath"

	"github.com/88250/gulu"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func zip(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	entryPath := arg["path"].(string)
	entryAbsPath, err := util.GetAbsPathInWorkspace(entryPath)
	if nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	zipFilePath := arg["zipPath"].(string)
	zipAbsFilePath, err := util.GetAbsPathInWorkspace(zipFilePath)
	if nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	zipFile, err := gulu.Zip.Create(zipAbsFilePath)
	if nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	base := filepath.Base(entryAbsPath)
	if gulu.File.IsDir(entryAbsPath) {
		err = zipFile.AddDirectory(base, entryAbsPath)
	} else {
		err = zipFile.AddEntry(base, entryAbsPath)
	}
	if nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	if err = zipFile.Close(); nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
}

func unzip(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	zipFilePath := arg["zipPath"].(string)
	zipAbsFilePath, err := util.GetAbsPathInWorkspace(zipFilePath)
	if nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	entryPath := arg["path"].(string)
	entryAbsPath, err := util.GetAbsPathInWorkspace(entryPath)
	if nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	if err := gulu.Zip.Unzip(zipAbsFilePath, entryAbsPath); nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
}
