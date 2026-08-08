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
	"fmt"
	"net/http"
	"os"
	"strings"

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

	var pathArg string
	if !util.ParseJsonArgs(arg, ret, util.BindJsonArg("path", &pathArg, true, true)) {
		return
	}

	absPath, err := model.GetAssetAbsPathInBox(pathArg, "")
	if err != nil {
		logging.LogErrorf("get asset [%s] abs path failed: %s", pathArg, err)
		ret.Code = -1
		ret.Msg = err.Error()
		ret.Data = map[string]any{"closeTimeout": 5000}
		return
	}
	if model.IsEncryptedAssetPath(absPath) {
		ret.Code = -1
		ret.Msg = model.Conf.Language(314)
		ret.Data = map[string]any{"closeTimeout": 5000}
		return
	}

	if err = util.WriteFilePaths([]string{absPath}); err != nil {
		logging.LogErrorf("write file path to clipboard failed: %s", err)
		ret.Code = -1
		ret.Msg = err.Error()
		ret.Data = map[string]any{"closeTimeout": 5000}
		return
	}
}

func prepareRichText(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}
	assetsArg, ok := util.ParseJsonArg[[]any]("assets", arg, ret, true, true)
	if !ok {
		return
	}

	assets := make([]model.RichClipboardAsset, 0, len(assetsArg))
	for i, rawAsset := range assetsArg {
		assetArg, typeOK := rawAsset.(map[string]any)
		if !typeOK {
			ret.Code = -1
			ret.Msg = fmt.Sprintf("Field [assets.%d] should be of type [Object]", i)
			return
		}

		index, indexOK := assetArg["index"].(float64)
		path, pathOK := assetArg["path"].(string)
		if !indexOK || index < 0 || index != float64(int(index)) || !pathOK || strings.TrimSpace(path) == "" {
			ret.Code = -1
			ret.Msg = fmt.Sprintf("Invalid rich clipboard asset at index [%d]", i)
			return
		}

		box := ""
		if boxArg, exists := assetArg["box"]; exists {
			box, typeOK = boxArg.(string)
			if !typeOK {
				ret.Code = -1
				ret.Msg = fmt.Sprintf("Field [assets.%d.box] should be of type [String]", i)
				return
			}
		}
		assets = append(assets, model.RichClipboardAsset{
			Index: int(index),
			Path:  strings.TrimSpace(path),
			Box:   strings.TrimSpace(box),
		})
	}

	prepared, err := model.PrepareRichClipboardAssets(assets)
	if err != nil {
		logging.LogWarnf("prepare rich clipboard assets failed: %s", err)
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
	ret.Data = prepared
}

func cleanupRichText(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}
	batch, ok := util.ParseJsonArg[string]("batch", arg, ret, true, true)
	if !ok {
		return
	}
	groupsArg, ok := util.ParseJsonArg[[]any]("groups", arg, ret, true, true)
	if !ok {
		return
	}

	groups := make([]string, 0, len(groupsArg))
	for i, rawGroup := range groupsArg {
		group, typeOK := rawGroup.(string)
		if !typeOK {
			ret.Code = -1
			ret.Msg = fmt.Sprintf("Field [groups.%d] should be of type [String]", i)
			return
		}
		groups = append(groups, group)
	}
	model.CleanupRichClipboardBatch(batch, groups)
}
