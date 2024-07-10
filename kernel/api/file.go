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
	"fmt"
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

func getUniqueFilename(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	filePath := arg["path"].(string)
	ret.Data = map[string]interface{}{
		"path": util.GetUniqueFilename(filePath),
	}
}

func globalCopyFiles(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	var srcs []string
	srcsArg := arg["srcs"].([]interface{})
	for _, s := range srcsArg {
		srcs = append(srcs, s.(string))
	}

	for _, src := range srcs {
		if !filelock.IsExist(src) {
			msg := fmt.Sprintf("file [%s] does not exist", src)
			logging.LogErrorf(msg)
			ret.Code = -1
			ret.Msg = msg
			return
		}
	}

	destDir := arg["destDir"].(string) // 相对于工作空间的路径
	destDir = filepath.Join(util.WorkspaceDir, destDir)
	for _, src := range srcs {
		dest := filepath.Join(destDir, filepath.Base(src))
		if err := filelock.Copy(src, dest); nil != err {
			logging.LogErrorf("copy file [%s] to [%s] failed: %s", src, dest, err)
			ret.Code = -1
			ret.Msg = err.Error()
			return
		}
	}
}

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
	fileAbsPath, err := util.GetAbsPathInWorkspace(filePath)
	if nil != err {
		ret.Code = http.StatusForbidden
		ret.Msg = err.Error()
		c.JSON(http.StatusAccepted, ret)
		return
	}
	info, err := os.Stat(fileAbsPath)
	if os.IsNotExist(err) {
		ret.Code = http.StatusNotFound
		ret.Msg = err.Error()
		c.JSON(http.StatusAccepted, ret)
		return
	}
	if nil != err {
		logging.LogErrorf("stat [%s] failed: %s", fileAbsPath, err)
		ret.Code = http.StatusInternalServerError
		ret.Msg = err.Error()
		c.JSON(http.StatusAccepted, ret)
		return
	}
	if info.IsDir() {
		logging.LogErrorf("path [%s] is a directory path", fileAbsPath)
		ret.Code = http.StatusMethodNotAllowed
		ret.Msg = "This is a directory path"
		c.JSON(http.StatusAccepted, ret)
		return
	}

	// REF: https://github.com/siyuan-note/siyuan/issues/11364
	if role := model.GetGinContextRole(c); !model.IsValidRole(role, []model.Role{
		model.RoleAdministrator,
	}) {
		if relPath, err := filepath.Rel(util.ConfDir, fileAbsPath); err != nil {
			logging.LogErrorf("Get a relative path from [%s] to [%s] failed: %s", util.ConfDir, fileAbsPath, err)
			ret.Code = http.StatusInternalServerError
			ret.Msg = err.Error()
			c.JSON(http.StatusAccepted, ret)
			return
		} else if relPath == "conf.json" {
			ret.Code = http.StatusForbidden
			ret.Msg = http.StatusText(http.StatusForbidden)
			c.JSON(http.StatusAccepted, ret)
			return
		}
	}

	data, err := filelock.ReadFile(fileAbsPath)
	if nil != err {
		logging.LogErrorf("read file [%s] failed: %s", fileAbsPath, err)
		ret.Code = http.StatusInternalServerError
		ret.Msg = err.Error()
		c.JSON(http.StatusAccepted, ret)
		return
	}

	contentType := mime.TypeByExtension(filepath.Ext(fileAbsPath))
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
	dirAbsPath, err := util.GetAbsPathInWorkspace(dirPath)
	if nil != err {
		ret.Code = http.StatusForbidden
		ret.Msg = err.Error()
		return
	}
	info, err := os.Stat(dirAbsPath)
	if os.IsNotExist(err) {
		ret.Code = http.StatusNotFound
		ret.Msg = err.Error()
		return
	}
	if nil != err {
		logging.LogErrorf("stat [%s] failed: %s", dirAbsPath, err)
		ret.Code = http.StatusInternalServerError
		ret.Msg = err.Error()
		return
	}
	if !info.IsDir() {
		logging.LogErrorf("file [%s] is not a directory", dirAbsPath)
		ret.Code = http.StatusMethodNotAllowed
		ret.Msg = "file is not a directory"
		return
	}

	entries, err := os.ReadDir(dirAbsPath)
	if nil != err {
		logging.LogErrorf("read dir [%s] failed: %s", dirAbsPath, err)
		ret.Code = http.StatusInternalServerError
		ret.Msg = err.Error()
		return
	}

	files := []map[string]interface{}{}
	for _, entry := range entries {
		path := filepath.Join(dirAbsPath, entry.Name())
		info, err = os.Stat(path)
		if nil != err {
			logging.LogErrorf("stat [%s] failed: %s", path, err)
			ret.Code = http.StatusInternalServerError
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

	srcPath := arg["path"].(string)
	srcAbsPath, err := util.GetAbsPathInWorkspace(srcPath)
	if nil != err {
		ret.Code = http.StatusForbidden
		ret.Msg = err.Error()
		return
	}
	if !filelock.IsExist(srcAbsPath) {
		ret.Code = http.StatusNotFound
		ret.Msg = "the [path] file or directory does not exist"
		return
	}

	destPath := arg["newPath"].(string)
	destAbsPath, err := util.GetAbsPathInWorkspace(destPath)
	if nil != err {
		ret.Code = http.StatusForbidden
		ret.Msg = err.Error()
		c.JSON(http.StatusAccepted, ret)
		return
	}
	if filelock.IsExist(destAbsPath) {
		ret.Code = http.StatusConflict
		ret.Msg = "the [newPath] file or directory already exists"
		return
	}

	if err := filelock.Rename(srcAbsPath, destAbsPath); nil != err {
		logging.LogErrorf("rename file [%s] to [%s] failed: %s", srcAbsPath, destAbsPath, err)
		ret.Code = http.StatusInternalServerError
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
	fileAbsPath, err := util.GetAbsPathInWorkspace(filePath)
	if nil != err {
		ret.Code = http.StatusForbidden
		ret.Msg = err.Error()
		return
	}
	_, err = os.Stat(fileAbsPath)
	if os.IsNotExist(err) {
		ret.Code = http.StatusNotFound
		return
	}
	if nil != err {
		logging.LogErrorf("stat [%s] failed: %s", fileAbsPath, err)
		ret.Code = http.StatusInternalServerError
		ret.Msg = err.Error()
		return
	}

	if err = filelock.Remove(fileAbsPath); nil != err {
		logging.LogErrorf("remove [%s] failed: %s", fileAbsPath, err)
		ret.Code = http.StatusInternalServerError
		ret.Msg = err.Error()
		return
	}
}

func putFile(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	var err error
	filePath := c.PostForm("path")
	fileAbsPath, err := util.GetAbsPathInWorkspace(filePath)
	if nil != err {
		ret.Code = http.StatusForbidden
		ret.Msg = err.Error()
		return
	}

	isDirStr := c.PostForm("isDir")
	isDir, _ := strconv.ParseBool(isDirStr)

	if isDir {
		err = os.MkdirAll(fileAbsPath, 0755)
		if nil != err {
			logging.LogErrorf("make dir [%s] failed: %s", fileAbsPath, err)
		}
	} else {
		fileHeader, _ := c.FormFile("file")
		if nil == fileHeader {
			logging.LogErrorf("form file is nil [path=%s]", fileAbsPath)
			ret.Code = http.StatusBadRequest
			ret.Msg = "form file is nil"
			return
		}

		for {
			dir := filepath.Dir(fileAbsPath)
			if err = os.MkdirAll(dir, 0755); nil != err {
				logging.LogErrorf("put file [%s] make dir [%s] failed: %s", fileAbsPath, dir, err)
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

			err = filelock.WriteFile(fileAbsPath, data)
			if nil != err {
				logging.LogErrorf("write file [%s] failed: %s", fileAbsPath, err)
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
			ret.Code = http.StatusInternalServerError
			ret.Msg = parseErr.Error()
			return
		}
		modTime = millisecond2Time(modTimeInt)
	}
	if err = os.Chtimes(fileAbsPath, modTime, modTime); nil != err {
		logging.LogErrorf("change time failed: %s", err)
		ret.Code = http.StatusInternalServerError
		ret.Msg = err.Error()
		return
	}
}

func millisecond2Time(t int64) time.Time {
	sec := t / 1000
	msec := t % 1000
	return time.Unix(sec, msec*int64(time.Millisecond))
}
