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
	"fmt"
	"github.com/imroc/req/v3"
	"github.com/siyuan-note/httpclient"
	"golang.org/x/exp/slices"
	"io"
	"os"
	"path"
	"path/filepath"
	"strings"

	"github.com/88250/gulu"
	"github.com/88250/lute/ast"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var (
	imageTypes = []string{".apng", ".ico", ".cur", ".jpg", ".jpe", ".jpeg", ".jfif",
		".pjp", ".pjpeg", ".png", ".gif", ".webp", ".bmp", ".svg"}
)

type PicgoApiResult struct {
	Success bool     `json:"success"` // return code
	Result  []string `json:"result"`  // message
}

func InsertLocalAssets(id string, assetPaths []string, isUpload bool, isUsePicgo bool) (succMap map[string]interface{}, err error) {
	succMap = map[string]interface{}{}
	picgoMode := Conf.Editor.PicgoMode
	enablePicgo := picgoMode == 1 || (picgoMode == 2 && isUsePicgo)
	if enablePicgo {
		logging.LogInfof("picgo enable")
	} else {
		logging.LogInfof("picgo disable")
	}
	bt := treenode.GetBlockTree(id)
	if nil == bt {
		err = errors.New(Conf.Language(71))
		return
	}

	docDirLocalPath := filepath.Join(util.DataDir, bt.BoxID, path.Dir(bt.Path))
	assetsDirPath := getAssetsDir(filepath.Join(util.DataDir, bt.BoxID), docDirLocalPath)
	if !gulu.File.IsExist(assetsDirPath) {
		if err = os.MkdirAll(assetsDirPath, 0755); nil != err {
			return
		}
	}

	for _, p := range assetPaths {
		fName := filepath.Base(p)
		fName = util.FilterUploadFileName(fName)
		ext := filepath.Ext(fName)
		fName = strings.TrimSuffix(fName, ext)
		ext = strings.ToLower(ext)
		fName += ext
		baseName := fName
		if gulu.File.IsDir(p) || !isUpload {
			if !strings.HasPrefix(p, "\\\\") {
				p = "file://" + p
			}
			succMap[baseName] = p
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
			var writePath string
			isPic := slices.Contains(imageTypes, ext)
			enablePicgo2 := enablePicgo && isPic
			if enablePicgo2 {
				tmpFName := "asset_tmp2_file_" + fName
				writePath = filepath.Join(util.TempDir, tmpFName)
			} else {
				writePath = filepath.Join(assetsDirPath, fName)
			}
			if _, err = f.Seek(0, io.SeekStart); nil != err {
				f.Close()
				return
			}
			if err = filelock.WriteFileByReader(writePath, f); nil != err {
				f.Close()
				return
			}
			f.Close()
			// upload with picgo
			if enablePicgo2 {
				logging.LogInfof("upload with picgo...")
				fileUrl, uploadErr := uploadWithPicgo(writePath)
				if nil != uploadErr {
					err = uploadErr
					break
				}
				logging.LogInfof("picgo upload success:", fileUrl)
				succMap[baseName] = fileUrl
				// remove local tmp file
				if err = filelock.Remove(writePath); nil != err {
					logging.LogErrorf("remove file [%s] failed: %s", writePath, err)
				}
			} else {
				succMap[baseName] = "assets/" + fName
			}
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
		logging.LogErrorf("insert asset failed: %s", err)
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
	var isUsePicgo string
	if nil != form.Value["isUsePicgo"] {
		isUsePicgo = form.Value["isUsePicgo"][0]
	}
	picgoMode := Conf.Editor.PicgoMode
	enablePicgo := picgoMode == 1 || (picgoMode == 2 && isUsePicgo == "true")
	if enablePicgo {
		logging.LogInfof("picgo enable")
	} else {
		logging.LogInfof("picgo disable")
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

	relAssetsDirPath := "assets"
	if nil != form.Value["assetsDirPath"] {
		relAssetsDirPath = form.Value["assetsDirPath"][0]
		assetsDirPath = filepath.Join(util.DataDir, relAssetsDirPath)
	}
	if !gulu.File.IsExist(assetsDirPath) {
		if err = os.MkdirAll(assetsDirPath, 0755); nil != err {
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
		tmpid := ast.NewNodeID()
		tmpFName := "asset_tmp1_file_" + fName + "-" + tmpid + ext
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
			var writePath string
			isPic := slices.Contains(imageTypes, ext)
			enablePicgo2 := enablePicgo && isPic
			if enablePicgo2 {
				writePath = filepath.Join(util.TempDir, tmpFName)
			} else {
				writePath = filepath.Join(assetsDirPath, fName)
			}
			if _, err = f.Seek(0, io.SeekStart); nil != err {
				errFiles = append(errFiles, fName)
				ret.Msg = err.Error()
				f.Close()
				break
			}
			if err = filelock.WriteFileByReader(writePath, f); nil != err {
				errFiles = append(errFiles, fName)
				ret.Msg = err.Error()
				f.Close()
				break
			}
			f.Close()
			// upload with picgo
			if enablePicgo2 {
				logging.LogInfof("upload with picgo...")
				fileUrl, uploadErr := uploadWithPicgo(writePath)
				if nil != uploadErr {
					errFiles = append(errFiles, fName)
					ret.Msg = uploadErr.Error()
					break
				}
				logging.LogInfof("picgo upload success:", fileUrl)
				succMap[baseName] = fileUrl
				// remove local tmp file
				if err = filelock.Remove(writePath); nil != err {
					logging.LogErrorf("remove file [%s] failed: %s", writePath, err)
				}
			} else {
				succMap[baseName] = strings.TrimPrefix(path.Join(relAssetsDirPath, fName), "/")
			}
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

// upload picture with picgo
// see 高级技巧 | PicGo
// https://picgo.github.io/PicGo-Doc/zh/guide/advance.html#picgo-server%E7%9A%84%E4%BD%BF%E7%94%A8
func uploadWithPicgo(filepath string) (ret string, err error) {
	ret = ""
	apiBody := make(map[string][]string)
	apiBody["list"] = append(apiBody["list"], filepath)

	result := &PicgoApiResult{
		Success: false,
		Result:  []string{},
	}
	request := httpclient.NewCloudRequest30s()
	request = request.
		SetSuccessResult(result).
		SetBody(apiBody)
	var resp *req.Response
	var sendErr error
	// default url: http://127.0.0.1:36677/upload
	var apiURL string
	picgoServePath := strings.TrimSpace(Conf.Editor.PicgoServePath)
	logging.LogInfof("picgoServePath:[%s]", picgoServePath)
	apiURL = strings.TrimSuffix(picgoServePath, "/") + "/upload"
	logging.LogInfof("picgoApiURL:[%s]", apiURL)

	resp, sendErr = request.Post(apiURL)
	if nil != sendErr {
		msg := fmt.Sprintf("PicgoUploadError::Post send failed: [%s]", sendErr.Error())
		logging.LogErrorf(msg)
		return "", errors.New(msg)
	}
	if 200 != resp.StatusCode {
		msg := fmt.Sprintf("PicgoUploadError::StatusCode failed [sc=%d]", resp.StatusCode)
		logging.LogErrorf(msg)
		return "", errors.New(msg)
	}
	logging.LogInfof("pigco api result:[%s]", result)
	if result.Success {
		if len(result.Result) > 0 {
			ret = result.Result[0]
			return ret, nil
		} else {
			return "", errors.New("PicgoUploadFailed::success but no result")
		}
	}
	return "", errors.New("PicgoUploadFailed::none")
}
