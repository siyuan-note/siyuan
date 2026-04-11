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
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func zip(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	var entryPath, zipFilePath string
	if !util.ParseJsonArgs(arg, ret,
		util.BindJsonArg("path", &entryPath, true, true),      // 相对于工作空间的路径（待打包目录或文件）
		util.BindJsonArg("zipPath", &zipFilePath, true, true), // 相对于工作空间的路径（生成的 zip）
	) {
		return
	}
	entryAbsPath, err := util.GetAbsPathInWorkspace(entryPath)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
	zipAbsFilePath, err := util.GetAbsPathInWorkspace(zipFilePath)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	zipFile, err := gulu.Zip.Create(zipAbsFilePath)
	if err != nil {
		logging.LogErrorf("create zip [%s] failed: %s", zipAbsFilePath, err)
		ret.Code = -1
		ret.Msg = "create zip file failed" + errMsgSeeKernelLog
		return
	}

	base := filepath.Base(entryAbsPath)
	if gulu.File.IsDir(entryAbsPath) {
		err = zipFile.AddDirectory(base, entryAbsPath)
	} else {
		err = zipFile.AddEntry(base, entryAbsPath)
	}
	if err != nil {
		logging.LogErrorf("zip add entry [%s] failed: %s", entryAbsPath, err)
		ret.Code = -1
		ret.Msg = "zip failed" + errMsgSeeKernelLog
		return
	}

	if err = zipFile.Close(); err != nil {
		logging.LogErrorf("close zip [%s] failed: %s", zipAbsFilePath, err)
		ret.Code = -1
		ret.Msg = "close zip file failed" + errMsgSeeKernelLog
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

	var zipFilePath, entryPath string
	if !util.ParseJsonArgs(arg, ret,
		util.BindJsonArg("zipPath", &zipFilePath, true, true), // 相对于工作空间的路径
		util.BindJsonArg("path", &entryPath, true, false),     // 相对于工作空间的路径（解压目标目录）
	) {
		return
	}
	zipAbsFilePath, err := util.GetAbsPathInWorkspace(zipFilePath)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
	entryAbsPath, err := util.GetAbsPathInWorkspace(entryPath)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	if !gulu.File.IsExist(zipAbsFilePath) {
		ret.Code = -1
		ret.Msg = "zip file does not exist"
		return
	}

	if err := gulu.Zip.Unzip(zipAbsFilePath, entryAbsPath); err != nil {
		logging.LogErrorf("unzip [%s] -> [%s] failed: %s", zipAbsFilePath, entryAbsPath, err)
		ret.Code = -1
		ret.Msg = "unzip failed" + errMsgSeeKernelLog
		return
	}
}
