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
	"mime"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"time"

	"github.com/88250/gulu"
	"github.com/gabriel-vasile/mimetype"
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
		ret.Code = -1
		c.JSON(http.StatusAccepted, ret)
		return
	}

	filePath := arg["path"].(string)
	filePath = filepath.Join(util.WorkspaceDir, filePath)
	info, err := os.Stat(filePath)
	if os.IsNotExist(err) {
		ret.Code = 404
		c.JSON(http.StatusAccepted, ret)
		return
	}
	if nil != err {
		logging.LogErrorf("stat [%s] failed: %s", filePath, err)
		ret.Code = 500
		ret.Msg = err.Error()
		c.JSON(http.StatusAccepted, ret)
		return
	}
	if info.IsDir() {
		logging.LogErrorf("file [%s] is a directory", filePath)
		ret.Code = 405
		ret.Msg = "file is a directory"
		c.JSON(http.StatusAccepted, ret)
		return
	}

	data, err := filelock.ReadFile(filePath)
	if nil != err {
		logging.LogErrorf("read file [%s] failed: %s", filePath, err)
		ret.Code = 500
		ret.Msg = err.Error()
		c.JSON(http.StatusAccepted, ret)
		return
	}

	contentType := mime.TypeByExtension(filepath.Ext(filePath))
	if "" == contentType {
		if m := mimetype.Detect(data); nil != m {
			contentType = m.String()
		}
	}
	if "" == contentType {
		contentType = "application/octet-stream"
	}
	c.Data(http.StatusOK, contentType, data)
}

func readDir(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		c.JSON(http.StatusOK, ret)
		return
	}

	dirPath := arg["path"].(string)
	dirPath = filepath.Join(util.WorkspaceDir, dirPath)
	info, err := os.Stat(dirPath)
	if os.IsNotExist(err) {
		ret.Code = 404
		return
	}
	if nil != err {
		logging.LogErrorf("stat [%s] failed: %s", dirPath, err)
		ret.Code = 500
		ret.Msg = err.Error()
		return
	}
	if !info.IsDir() {
		logging.LogErrorf("file [%s] is not a directory", dirPath)
		ret.Code = 405
		ret.Msg = "file is not a directory"
		return
	}

	entries, err := os.ReadDir(dirPath)
	if nil != err {
		logging.LogErrorf("read dir [%s] failed: %s", dirPath, err)
		ret.Code = 500
		ret.Msg = err.Error()
		return
	}

	files := []map[string]interface{}{}
	for _, entry := range entries {
		path := filepath.Join(dirPath, entry.Name())
		info, err = os.Stat(path)
		if nil != err {
			logging.LogErrorf("stat [%s] failed: %s", path, err)
			ret.Code = 500
			ret.Msg = err.Error()
			return
		}
		files = append(files, map[string]interface{}{
			"name":      entry.Name(),
			"isDir":     info.IsDir(),
			"isSymlink": util.IsSymlink(entry),
			"updated":   info.ModTime().Unix(),
		})
	}

	ret.Data = files
}

func renameFile(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		c.JSON(http.StatusOK, ret)
		return
	}

	filePath := arg["path"].(string)
	filePath = filepath.Join(util.WorkspaceDir, filePath)
	_, err := os.Stat(filePath)
	if os.IsNotExist(err) {
		ret.Code = 404
		ret.Msg = err.Error()
		return
	}
	if nil != err {
		logging.LogErrorf("stat [%s] failed: %s", filePath, err)
		ret.Code = 500
		ret.Msg = err.Error()
		return
	}

	newPath := arg["newPath"].(string)
	newPath = filepath.Join(util.WorkspaceDir, newPath)
	if gulu.File.IsExist(newPath) {
		ret.Code = 409
		ret.Msg = "the [newPath] file or directory already exists"
		return
	}

	if err = filelock.Rename(filePath, newPath); nil != err {
		logging.LogErrorf("rename file [%s] to [%s] failed: %s", filePath, newPath, err)
		ret.Code = 500
		ret.Msg = err.Error()
		return
	}
}

func removeFile(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		c.JSON(http.StatusOK, ret)
		return
	}

	filePath := arg["path"].(string)
	filePath = filepath.Join(util.WorkspaceDir, filePath)
	_, err := os.Stat(filePath)
	if os.IsNotExist(err) {
		ret.Code = 404
		return
	}
	if nil != err {
		logging.LogErrorf("stat [%s] failed: %s", filePath, err)
		ret.Code = 500
		ret.Msg = err.Error()
		return
	}

	if err = filelock.Remove(filePath); nil != err {
		logging.LogErrorf("remove [%s] failed: %s", filePath, err)
		ret.Code = 500
		ret.Msg = err.Error()
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
			ret.Code = 400
			ret.Msg = "form file is nil"
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
	modTime := time.Now()
	if "" != modTimeStr {
		modTimeInt, parseErr := strconv.ParseInt(modTimeStr, 10, 64)
		if nil != parseErr {
			logging.LogErrorf("parse mod time [%s] failed: %s", modTimeStr, parseErr)
			ret.Code = 500
			ret.Msg = parseErr.Error()
			return
		}
		modTime = millisecond2Time(modTimeInt)
	}
	if err = os.Chtimes(filePath, modTime, modTime); nil != err {
		logging.LogErrorf("change time failed: %s", err)
		ret.Code = 500
		ret.Msg = err.Error()
		return
	}
}

func millisecond2Time(t int64) time.Time {
	sec := t / 1000
	msec := t % 1000
	return time.Unix(sec, msec*int64(time.Millisecond))
}
