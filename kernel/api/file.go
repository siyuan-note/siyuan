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
	"errors"
	"fmt"
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
		file, _ := c.FormFile("file")
		if nil == file {
			logging.LogErrorf("form file is nil [path=%s]", filePath)
			c.Status(400)
			return
		}

		dir := filepath.Dir(filePath)
		if err = os.MkdirAll(dir, 0755); nil != err {
			logging.LogErrorf("put a file [%s] make dir [%s] failed: %s", filePath, dir, err)
		} else {
			if filelock.IsLocked(filePath) {
				msg := fmt.Sprintf("file [%s] is locked", filePath)
				logging.LogErrorf(msg)
				err = errors.New(msg)
			} else {
				err = writeFile(file, filePath)
				if nil != err {
					logging.LogErrorf("put a file [%s] failed: %s", filePath, err)
				}
			}
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

func writeFile(file *multipart.FileHeader, dst string) error {
	src, err := file.Open()
	if err != nil {
		return err
	}
	defer src.Close()

	err = gulu.File.WriteFileSaferByReader(dst, src, 0644)
	if nil != err {
		return err
	}
	return nil
}

func millisecond2Time(t int64) time.Time {
	sec := t / 1000
	msec := t % 1000
	return time.Unix(sec, msec*int64(time.Millisecond))
}
