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
	"context"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/88250/gulu"
	"github.com/panjf2000/ants/v2"
	"github.com/qiniu/go-sdk/v7/storage"
	"github.com/siyuan-note/httpclient"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func getCloudSpaceOSS() (sync, backup map[string]interface{}, assetSize int64, err error) {
	result := map[string]interface{}{}
	resp, err := httpclient.NewCloudRequest().
		SetResult(&result).
		SetBody(map[string]string{"token": Conf.User.UserToken}).
		Post(util.AliyunServer + "/apis/siyuan/dejavu/getRepoStat?uid=" + Conf.User.UserId)

	if nil != err {
		util.LogErrorf("get cloud space failed: %s", err)
		err = ErrFailedToConnectCloudServer
		return
	}

	if 401 == resp.StatusCode {
		err = errors.New(Conf.Language(31))
		return
	}

	code := result["code"].(float64)
	if 0 != code {
		util.LogErrorf("get cloud space failed: %s", result["msg"])
		err = errors.New(result["msg"].(string))
		return
	}

	data := result["data"].(map[string]interface{})
	sync = data["sync"].(map[string]interface{})
	backup = data["backup"].(map[string]interface{})
	assetSize = int64(data["assetSize"].(float64))
	return
}

func ossUpload(isBackup bool, localDirPath, cloudDirPath, cloudDevice string, boot bool) (wroteFiles int, transferSize uint64, err error) {
	if !gulu.File.IsExist(localDirPath) {
		return
	}

	localDevice := Conf.System.ID
	var localFileList, cloudFileList map[string]*CloudIndex
	if "" != localDevice && localDevice == cloudDevice && !isBackup {
		// 同一台设备连续上传，使用上一次的本地索引作为云端索引
		cloudFileList, err = getLocalFileListOSS(isBackup)
	} else {
		cloudFileList, err = getCloudFileListOSS(cloudDirPath)
	}
	if nil != err {
		return
	}

	calcHash := false
	if 0 < len(cloudFileList) {
		if idx := cloudFileList["/index.json"]; nil != idx {
			calcHash = 0 == idx.Updated
		}
	}

	excludes := getSyncExcludedList(localDirPath)
	localFileList, err = genCloudIndex(localDirPath, excludes, calcHash)
	if nil != err {
		return
	}

	var localUpserts, cloudRemoves []string
	localUpserts, cloudRemoves, err = cloudUpsertRemoveListOSS(localDirPath, cloudFileList, localFileList, excludes)
	if nil != err {
		return
	}

	err = ossRemove0(cloudDirPath, cloudRemoves)
	if nil != err {
		return
	}

	needPushProgress := 32 < len(localUpserts)
	waitGroup := &sync.WaitGroup{}
	var uploadErr error

	poolSize := 4
	if poolSize > len(localUpserts) {
		poolSize = len(localUpserts)
	}
	msgId := gulu.Rand.String(7)
	p, _ := ants.NewPoolWithFunc(poolSize, func(arg interface{}) {
		defer waitGroup.Done()
		if nil != uploadErr {
			return // 快速失败
		}
		localUpsert := arg.(string)
		err = ossUpload0(localDirPath, cloudDirPath, localUpsert, &wroteFiles, &transferSize)
		if nil != err {
			uploadErr = err
			return
		}
		if needPushProgress {
			util.PushUpdateMsg(msgId, fmt.Sprintf(Conf.Language(104), wroteFiles, len(localUpserts)-wroteFiles), 1000*60)
		}
		if boot {
			msg := fmt.Sprintf("Uploading data to the cloud %d/%d", wroteFiles, len(localUpserts))
			util.IncBootProgress(0, msg)
		}
	})
	index := filepath.Join(localDirPath, "index.json")
	meta := filepath.Join(localDirPath, pathJSON)
	for _, localUpsert := range localUpserts {
		if index == localUpsert || meta == localUpsert {
			// 同步过程中断导致的一致性问题 https://github.com/siyuan-note/siyuan/issues/4912
			// index 和路径映射文件最后单独上传
			continue
		}

		waitGroup.Add(1)
		p.Invoke(localUpsert)
	}
	waitGroup.Wait()
	p.Release()
	if nil != uploadErr {
		err = uploadErr
		return
	}

	// 单独上传 index 和路径映射
	if uploadErr = ossUpload0(localDirPath, cloudDirPath, index, &wroteFiles, &transferSize); nil != uploadErr {
		err = uploadErr
		return
	}
	if uploadErr = ossUpload0(localDirPath, cloudDirPath, meta, &wroteFiles, &transferSize); nil != uploadErr {
		err = uploadErr
		return
	}

	if needPushProgress {
		util.PushMsg(Conf.Language(105), 3000)
		util.PushClearMsg(msgId)
	}
	return
}

func ossRemove0(cloudDirPath string, removes []string) (err error) {
	if 1 > len(removes) {
		return
	}

	request := httpclient.NewCloudRequest()
	resp, err := request.
		SetBody(map[string]interface{}{"token": Conf.User.UserToken, "dirPath": cloudDirPath, "paths": removes}).
		Post(util.AliyunServer + "/apis/siyuan/data/removeSiYuanFile?uid=" + Conf.User.UserId)
	if nil != err {
		util.LogErrorf("remove cloud file failed: %s", err)
		err = ErrFailedToConnectCloudServer
		return
	}

	if 401 == resp.StatusCode {
		err = errors.New(Conf.Language(31))
		return
	}

	if 200 != resp.StatusCode {
		msg := fmt.Sprintf("remove cloud file failed [sc=%d]", resp.StatusCode)
		util.LogErrorf(msg)
		err = errors.New(msg)
		return
	}
	return
}

func ossUpload0(localDirPath, cloudDirPath, localUpsert string, wroteFiles *int, transferSize *uint64) (err error) {
	info, statErr := os.Stat(localUpsert)
	if nil != statErr {
		util.LogErrorf("stat file [%s] failed: %s", localUpsert, statErr)
		err = statErr
		return
	}

	filename := filepath.ToSlash(strings.TrimPrefix(localUpsert, localDirPath))
	upToken, err := getOssUploadToken(filename, cloudDirPath, info.Size())
	if nil != err {
		return
	}

	key := path.Join("siyuan", Conf.User.UserId, cloudDirPath, filename)
	if err = putFileToCloud(localUpsert, key, upToken); nil != err {
		util.LogErrorf("put file [%s] to cloud failed: %s", localUpsert, err)
		return errors.New(fmt.Sprintf(Conf.Language(94), err))
	}

	//util.LogInfof("cloud wrote [%s], size [%d]", filename, info.Size())
	*wroteFiles++
	*transferSize += uint64(info.Size())
	return
}

func getOssUploadToken(filename, cloudDirPath string, length int64) (ret string, err error) {
	// 因为需要指定 key，所以每次上传文件都必须在云端生成 Token，否则有安全隐患

	var result map[string]interface{}
	req := httpclient.NewCloudRequest().
		SetResult(&result)
	req.SetBody(map[string]interface{}{
		"token":   Conf.User.UserToken,
		"dirPath": cloudDirPath,
		"name":    filename,
		"length":  length})
	resp, err := req.Post(util.AliyunServer + "/apis/siyuan/data/getSiYuanFileUploadToken?uid=" + Conf.User.UserId)
	if nil != err {
		util.LogErrorf("get file [%s] upload token failed: %+v", filename, err)
		err = errors.New(fmt.Sprintf(Conf.Language(94), err))
		return
	}

	if 200 != resp.StatusCode {
		if 401 == resp.StatusCode {
			err = errors.New(fmt.Sprintf(Conf.Language(94), Conf.Language(31)))
			return
		}
		util.LogErrorf("get file [%s] upload token failed [sc=%d]", filename, resp.StatusCode)
		err = errors.New(fmt.Sprintf(Conf.Language(94), strconv.Itoa(resp.StatusCode)))
		return
	}

	code := result["code"].(float64)
	if 0 != code {
		msg := result["msg"].(string)
		util.LogErrorf("get file [%s] upload token failed: %s", filename, msg)
		err = errors.New(fmt.Sprintf(Conf.Language(93), msg))
		return
	}

	resultData := result["data"].(map[string]interface{})
	ret = resultData["token"].(string)
	return
}

func getLocalFileListOSS(isBackup bool) (ret map[string]*CloudIndex, err error) {
	ret = map[string]*CloudIndex{}
	dir := "sync"
	if isBackup {
		dir = "backup"
	}

	localDirPath := filepath.Join(util.WorkspaceDir, dir)
	indexPath := filepath.Join(localDirPath, "index.json")
	if !gulu.File.IsExist(indexPath) {
		return
	}

	data, err := os.ReadFile(indexPath)
	if nil != err {
		return
	}

	err = gulu.JSON.UnmarshalJSON(data, &ret)
	return
}

func cloudUpsertRemoveListOSS(localDirPath string, cloudFileList, localFileList map[string]*CloudIndex, excludes map[string]bool) (localUpserts, cloudRemoves []string, err error) {
	localUpserts, cloudRemoves = []string{}, []string{}

	unchanged := map[string]bool{}
	for cloudFile, cloudIdx := range cloudFileList {
		localIdx := localFileList[cloudFile]
		if nil == localIdx {
			cloudRemoves = append(cloudRemoves, cloudFile)
			continue
		}
		if 0 < cloudIdx.Updated {
			// 优先使用时间戳校验
			if localIdx.Updated == cloudIdx.Updated {
				unchanged[filepath.Join(localDirPath, cloudFile)] = true
			}
			continue
		}

		if localIdx.Hash == cloudIdx.Hash {
			unchanged[filepath.Join(localDirPath, cloudFile)] = true
			continue
		}
	}

	filepath.Walk(localDirPath, func(path string, info fs.FileInfo, err error) error {
		if localDirPath == path || info.IsDir() {
			return nil
		}

		if !unchanged[path] {
			if excludes[path] {
				return nil
			}
			if util.CloudSingleFileMaxSizeLimit < info.Size() {
				util.LogWarnf("file [%s] larger than 100MB, ignore uploading it", path)
				return nil
			}
			localUpserts = append(localUpserts, path)
			return nil
		}
		return nil
	})
	return
}

func putFileToCloud(filePath, key, upToken string) (err error) {
	formUploader := storage.NewFormUploader(&storage.Config{UseHTTPS: true})
	ret := storage.PutRet{}
	err = formUploader.PutFile(context.Background(), &ret, upToken, key, filePath, nil)
	if nil != err {
		util.LogWarnf("put file [%s] to cloud failed [%s], retry it after 3s", filePath, err)
		time.Sleep(3 * time.Second)
		err = formUploader.PutFile(context.Background(), &ret, upToken, key, filePath, nil)
		if nil != err {
			return
		}
		util.LogInfof("put file [%s] to cloud retry success", filePath)
	}
	return
}
