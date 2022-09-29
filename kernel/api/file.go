// SiYuan - Build Your Eternal Digital Garden
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
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"time"

	"github.com/88250/gulu"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func copyFile(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	src := arg["src"].(string)
	src, err := model.GetAssetAbsPath(src)
	if nil != err {
		logging.LogErrorf("get asset [%s] abs path failed: %s", src, err)
		ret.Code = -1
		ret.Msg = err.Error()
		ret.Data = map[string]interface{}{"closeTimeout": 5000}
		return
	}

	info, err := os.Stat(src)
	if nil != err {
		logging.LogErrorf("stat [%s] failed: %s", src, err)
		ret.Code = -1
		ret.Msg = err.Error()
		ret.Data = map[string]interface{}{"closeTimeout": 5000}
		return
	}

	if info.IsDir() {
		ret.Code = -1
		ret.Msg = "file is a directory"
		ret.Data = map[string]interface{}{"closeTimeout": 5000}
		return
	}

	dest := arg["dest"].(string)
	if err = filelock.Copy(src, dest); nil != err {
		logging.LogErrorf("copy file [%s] to [%s] failed: %s", src, dest, err)
		ret.Code = -1
		ret.Msg = err.Error()
		ret.Data = map[string]interface{}{"closeTimeout": 5000}
		return
	}
}

func getFile(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	arg, ok := util.JsonArg(c, ret)
	if !ok {
		c.JSON(http.StatusOK, ret)
		return
	}

	filePath := arg["path"].(string)
	filePath = filepath.Join(util.WorkspaceDir, filePath)
	info, err := os.Stat(filePath)
	if os.IsNotExist(err) {
		c.Status(404)
		return
	}
	if nil != err {
		logging.LogErrorf("stat [%s] failed: %s", filePath, err)
		c.Status(500)
		return
	}
	if info.IsDir() {
		logging.LogErrorf("file [%s] is a directory", filePath)
		c.Status(405)
		return
	}

	if err = model.ServeFile(c, filePath); nil != err {
		c.Status(http.StatusConflict)
		return
	}
}

func putFile(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	filePath := c.PostForm("path")
	filePath = filepath.Join(util.WorkspaceDir, filePath)
	isDirStr := c.PostForm("isDir")
	isDir, _ := strconv.ParseBool(isDirStr)

	var err error
	if isDir {
		err = os.MkdirAll(filePath, 0755)
		if nil != err {
			logging.LogErrorf("make a dir [%s] failed: %s", filePath, err)
		}
	} else {
		fileHeader, _ := c.FormFile("file")
		if nil == fileHeader {
			logging.LogErrorf("form file is nil [path=%s]", filePath)
			c.Status(400)
			return
		}

		for {
			dir := filepath.Dir(filePath)
			if err = os.MkdirAll(dir, 0755); nil != err {
				logging.LogErrorf("put a file [%s] make dir [%s] failed: %s", filePath, dir, err)
				break
			}

			var f multipart.File
			f, err = fileHeader.Open()
			if nil != err {
				logging.LogErrorf("open file failed: %s", err)
				break
			}

			var data []byte
			data, err = io.ReadAll(f)
			if nil != err {
				logging.LogErrorf("read file failed: %s", err)
				break
			}

			err = filelock.WriteFile(filePath, data)
			if nil != err {
				logging.LogErrorf("put a file [%s] failed: %s", filePath, err)
				break
			}
			break
		}
	}
	if nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	modTimeStr := c.PostForm("modTime")
	modTimeInt, err := strconv.ParseInt(modTimeStr, 10, 64)
	if nil != err {
		logging.LogErrorf("parse mod time [%s] failed: %s", modTimeStr, err)
		c.Status(500)
		return
	}
	modTime := millisecond2Time(modTimeInt)
	if err = os.Chtimes(filePath, modTime, modTime); nil != err {
		logging.LogErrorf("change time failed: %s", err)
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
}

func millisecond2Time(t int64) time.Time {
	sec := t / 1000
	msec := t % 1000
	return time.Unix(sec, msec*int64(time.Millisecond))
}
