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

package model

import (
	"errors"
	"io"
	"os"
	"path"
	"path/filepath"
	"strings"

	"github.com/88250/gulu"
	"github.com/88250/lute/ast"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func InsertLocalAssets(id string, assetPaths []string) (succMap map[string]interface{}, err error) {
	succMap = map[string]interface{}{}

	bt := treenode.GetBlockTree(id)
	if nil == bt {
		err = errors.New(Conf.Language(71))
		return
	}

	docDirLocalPath := filepath.Join(util.DataDir, bt.BoxID, path.Dir(bt.Path))
	assets := getAssetsDir(filepath.Join(util.DataDir, bt.BoxID), docDirLocalPath)
	for _, p := range assetPaths {
		fName := filepath.Base(p)
		fName = util.FilterUploadFileName(fName)
		ext := filepath.Ext(fName)
		fName = strings.TrimSuffix(fName, ext)
		ext = strings.ToLower(ext)
		fName += ext
		baseName := fName
		if gulu.File.IsDir(p) {
			succMap[baseName] = "file://" + p
			continue
		}

		fi, statErr := os.Stat(p)
		if nil != statErr {
			err = statErr
			return
		}
		f, openErr := os.Open(p)
		if nil != openErr {
			err = openErr
			return
		}
		hash, hashErr := util.GetEtagByHandle(f, fi.Size())
		if nil != hashErr {
			f.Close()
			return
		}

		if existAsset := sql.QueryAssetByHash(hash); nil != existAsset {
			// 已经存在同样数据的资源文件的话不重复保存
			succMap[baseName] = existAsset.Path
		} else {
			ext := path.Ext(fName)
			fName = fName[0 : len(fName)-len(ext)]
			fName = fName + "-" + ast.NewNodeID() + ext
			writePath := filepath.Join(assets, fName)
			if _, err = f.Seek(0, io.SeekStart); nil != err {
				f.Close()
				return
			}
			if err = gulu.File.WriteFileSaferByReader(writePath, f, 0644); nil != err {
				f.Close()
				return
			}
			f.Close()
			succMap[baseName] = "assets/" + fName
		}
	}
	IncSync()
	return
}

func Upload(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(200, ret)

	form, err := c.MultipartForm()
	if nil != err {
		util.LogErrorf("insert asset failed: %s", err)
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
	assetsDirPath := filepath.Join(util.DataDir, "assets")
	if nil != form.Value["id"] {
		id := form.Value["id"][0]
		bt := treenode.GetBlockTree(id)
		if nil == bt {
			ret.Code = -1
			ret.Msg = Conf.Language(71)
			return
		}
		docDirLocalPath := filepath.Join(util.DataDir, bt.BoxID, path.Dir(bt.Path))
		assetsDirPath = getAssetsDir(filepath.Join(util.DataDir, bt.BoxID), docDirLocalPath)
	}
	if nil != form.Value["assetsDirPath"] {
		assetsDirPath = form.Value["assetsDirPath"][0]
		assetsDirPath = filepath.Join(util.DataDir, assetsDirPath)
		if err := os.MkdirAll(assetsDirPath, 0755); nil != err {
			ret.Code = -1
			ret.Msg = err.Error()
			return
		}
	}

	var errFiles []string
	succMap := map[string]interface{}{}
	files := form.File["file[]"]
	for _, file := range files {
		fName := file.Filename
		fName = util.FilterUploadFileName(fName)
		ext := filepath.Ext(fName)
		fName = strings.TrimSuffix(fName, ext)
		ext = strings.ToLower(ext)
		fName += ext
		baseName := fName
		f, openErr := file.Open()
		if nil != openErr {
			errFiles = append(errFiles, fName)
			ret.Msg = openErr.Error()
			break
		}

		hash, hashErr := util.GetEtagByHandle(f, file.Size)
		if nil != hashErr {
			errFiles = append(errFiles, fName)
			ret.Msg = err.Error()
			f.Close()
			break
		}

		if existAsset := sql.QueryAssetByHash(hash); nil != existAsset {
			// 已经存在同样数据的资源文件的话不重复保存
			succMap[baseName] = existAsset.Path
		} else {
			fName = util.AssetName(fName)
			writePath := filepath.Join(assetsDirPath, fName)
			if _, err = f.Seek(0, io.SeekStart); nil != err {
				errFiles = append(errFiles, fName)
				ret.Msg = err.Error()
				f.Close()
				break
			}
			if err = gulu.File.WriteFileSaferByReader(writePath, f, 0644); nil != err {
				errFiles = append(errFiles, fName)
				ret.Msg = err.Error()
				f.Close()
				break
			}
			f.Close()
			succMap[baseName] = "assets/" + fName
		}
	}

	ret.Data = map[string]interface{}{
		"errFiles": errFiles,
		"succMap":  succMap,
	}

	IncSync()
}

func getAssetsDir(boxLocalPath, docDirLocalPath string) (assets string) {
	assets = filepath.Join(docDirLocalPath, "assets")
	if !gulu.File.IsExist(assets) {
		assets = filepath.Join(boxLocalPath, "assets")
		if !gulu.File.IsExist(assets) {
			assets = filepath.Join(util.DataDir, "assets")
		}
	}
	return
}
