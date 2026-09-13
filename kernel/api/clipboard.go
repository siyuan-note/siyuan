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
	"os"

	"github.com/88250/clipboard"
	"github.com/88250/gulu"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var readFilePaths = contractHandler(apicontract.ReadClipboardFilePaths, func(c *gin.Context, request apicontract.EmptyRequest) apicontract.Response[[]apicontract.ClipboardFile] {

	var paths []string
	if !gulu.OS.IsLinux() { // Linux 端不再支持 `粘贴为纯文本` 时处理文件绝对路径 https://github.com/siyuan-note/siyuan/issues/5825
		paths, _ = clipboard.ReadFilePaths()
	}

	data := []apicontract.ClipboardFile{}
	for _, path := range paths {
		fi, err := os.Stat(path)
		if nil != err {
			logging.LogErrorf("stat file failed: %s", err)
			continue
		}

		data = append(data, apicontract.ClipboardFile{Name: fi.Name(), Size: fi.Size(), IsDir: fi.IsDir(), Updated: fi.ModTime().UnixMilli(), Path: path})
	}
	return apicontract.Success(data)
})

var writeFilePath = contractHandler(apicontract.WriteClipboardFilePath, func(c *gin.Context, request apicontract.ClipboardPathRequest) apicontract.Response[apicontract.Null] {
	pathArg := request.Path
	absPath, err := model.GetAssetAbsPathInBox(pathArg, "")
	if err != nil {
		logging.LogErrorf("get asset [%s] abs path failed: %s", pathArg, err)
		return apicontract.FailureWithTimeout[apicontract.Null](-1, err.Error(), 5000)
	}
	if model.IsEncryptedAssetPath(absPath) {
		return apicontract.FailureWithTimeout[apicontract.Null](-1, model.Conf.Language(314), 5000)
	}

	if err = model.EnsureAssetPrefixLocal(absPath); err != nil {
		return apicontract.FailureWithTimeout[apicontract.Null](-1, err.Error(), 7000)
	}
	if err = util.WriteFilePaths([]string{absPath}); err != nil {
		logging.LogErrorf("write file path to clipboard failed: %s", err)
		return apicontract.FailureWithTimeout[apicontract.Null](-1, err.Error(), 5000)
	}
	return apicontract.Success(apicontract.Null{})
})

var prepareRichText = contractHandler(apicontract.PrepareRichText, func(c *gin.Context, request apicontract.PrepareRichTextRequest) apicontract.Response[*apicontract.RichClipboardPrepared] {
	assets := make([]model.RichClipboardAsset, 0, len(request.Assets))
	for _, asset := range request.Assets {
		assets = append(assets, model.RichClipboardAsset{Index: asset.Index, Path: asset.Path, Box: asset.Box})
	}
	prepared, err := model.PrepareRichClipboardAssets(assets)
	if err != nil {
		logging.LogWarnf("prepare rich clipboard assets failed: %s", err)
		return apicontract.Failure[*apicontract.RichClipboardPrepared](-1, err.Error())
	}
	if prepared == nil {
		return apicontract.Success[*apicontract.RichClipboardPrepared](nil)
	}
	result := &apicontract.RichClipboardPrepared{Batch: prepared.Batch, Groups: prepared.Groups}
	if prepared.Assets != nil {
		result.Assets = make([]apicontract.RichClipboardPreparedAsset, 0, len(prepared.Assets))
	}
	for _, asset := range prepared.Assets {
		result.Assets = append(result.Assets, apicontract.RichClipboardPreparedAsset{Index: asset.Index, Path: asset.Path})
	}
	return apicontract.Success(result)
})

var cleanupRichText = contractHandler(apicontract.CleanupRichText, func(c *gin.Context, request apicontract.CleanupRichTextRequest) apicontract.Response[apicontract.Null] {
	model.CleanupRichClipboardBatch(request.Batch, request.Groups)
	return apicontract.Success(apicontract.Null{})
})
