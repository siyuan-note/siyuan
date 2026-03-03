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
	"os"

	"github.com/88250/clipboard"
	"github.com/88250/gulu"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func readFilePaths(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	var paths []string
	if !gulu.OS.IsLinux() { // Linux 端不再支持 `粘贴为纯文本` 时处理文件绝对路径 https://github.com/siyuan-note/siyuan/issues/5825
		paths, _ = clipboard.ReadFilePaths()
	}

	data := []map[string]any{}
	for _, path := range paths {
		fi, err := os.Stat(path)
		if nil != err {
			logging.LogErrorf("stat file failed: %s", err)
			continue
		}

		data = append(data, map[string]any{
			"name":    fi.Name(),
			"size":    fi.Size(),
			"isDir":   fi.IsDir(),
			"updated": fi.ModTime().UnixMilli(),
			"path":    path,
		})
	}
	ret.Data = data
}

func writeFilePath(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	pathArg, ok := arg["path"].(string)
	if !ok || pathArg == "" {
		ret.Code = -1
		ret.Msg = "path is required"
		return
	}

	absPath, err := model.GetAssetAbsPath(pathArg)
	if err != nil {
		logging.LogErrorf("get asset [%s] abs path failed: %s", pathArg, err)
		ret.Code = -1
		ret.Msg = err.Error()
		ret.Data = map[string]interface{}{"closeTimeout": 5000}
		return
	}

	if err = util.WriteFilePaths([]string{absPath}); err != nil {
		logging.LogErrorf("write file path to clipboard failed: %s", err)
		ret.Code = -1
		ret.Msg = err.Error()
		ret.Data = map[string]interface{}{"closeTimeout": 5000}
		return
	}
}
