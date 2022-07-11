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
	"bytes"
	"crypto/sha256"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/88250/gulu"
	"github.com/dustin/go-humanize"
	gitignore "github.com/sabhiram/go-gitignore"
	"github.com/siyuan-note/dejavu"
	"github.com/siyuan-note/encryption"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var (
	syncSameCount        = 0
	syncDownloadErrCount = 0
	fixSyncInterval      = 5 * time.Minute
	syncPlanTime         = time.Now().Add(fixSyncInterval)

	BootSyncSucc = -1 // -1：未执行，0：执行成功，1：执行失败
	ExitSyncSucc = -1
)

func AutoSync() {
	for {
		time.Sleep(5 * time.Second)
		if time.Now().After(syncPlanTime) {
			SyncData(false, false, false)
		}
	}
}

func SyncData(boot, exit, byHand bool) {
	defer util.Recover()

	if !boot && !exit && 2 == Conf.Sync.Mode && !byHand {
		return
	}

	if util.IsMutexLocked(&syncLock) {
		util.LogWarnf("sync is in progress")
		planSyncAfter(30 * time.Second)
		return
	}

	if boot {
		util.IncBootProgress(3, "Syncing data from the cloud...")
		BootSyncSucc = 0
	}
	if exit {
		ExitSyncSucc = 0
	}
	if !IsSubscriber() || !Conf.Sync.Enabled || "" == Conf.Sync.CloudName || ("" == Conf.E2EEPasswd && !Conf.Sync.UseDataRepo) {
		if byHand {
			if "" == Conf.Sync.CloudName {
				util.PushMsg(Conf.Language(123), 5000)
			} else if "" == Conf.E2EEPasswd {
				util.PushMsg(Conf.Language(11), 5000)
			} else if !Conf.Sync.Enabled {
				util.PushMsg(Conf.Language(124), 5000)
			}
		}
		return
	}

	if !IsValidCloudDirName(Conf.Sync.CloudName) {
		return
	}

	if boot {
		util.LogInfof("sync before boot")
	}
	if exit {
		util.LogInfof("sync before exit")
		util.PushMsg(Conf.Language(81), 1000*60*15)
	}

	if 7 < syncDownloadErrCount && !byHand {
		util.LogErrorf("sync download error too many times, cancel auto sync, try to sync by hand")
		util.PushErrMsg(Conf.Language(125), 1000*60*60)
		planSyncAfter(64 * time.Minute)
		return
	}

	now := util.CurrentTimeMillis()
	Conf.Sync.Synced = now

	util.BroadcastByType("main", "syncing", 0, Conf.Language(81), nil)
	defer func() {
		synced := util.Millisecond2Time(Conf.Sync.Synced).Format("2006-01-02 15:04:05") + "\n\n" + Conf.Sync.Stat
		msg := fmt.Sprintf(Conf.Language(82), synced)
		Conf.Sync.Stat = msg
		Conf.Save()
		util.BroadcastByType("main", "syncing", 1, msg, nil)
	}()

	Conf.Sync.Stat = Conf.Language(133)
	syncLock.Lock()
	defer syncLock.Unlock()

	if Conf.Sync.UseDataRepo {
		syncRepo(boot, exit, byHand)
		return
	}

	WaitForWritingFiles()
	writingDataLock.Lock()
	var err error
	// 将 data 变更同步到 sync
	if _, _, err = workspaceData2SyncDir(); nil != err {
		msg := fmt.Sprintf(Conf.Language(80), formatErrorMsg(err))
		Conf.Sync.Stat = msg
		util.PushErrMsg(msg, 7000)
		if boot {
			BootSyncSucc = 1
		}
		if exit {
			ExitSyncSucc = 1
		}
		writingDataLock.Unlock()
		return
	}

	// 获取工作空间数据配置（数据版本）
	dataConf, err := getWorkspaceDataConf()
	if nil != err {
		msg := fmt.Sprintf(Conf.Language(80), formatErrorMsg(err))
		Conf.Sync.Stat = msg
		util.PushErrMsg(msg, 7000)
		if boot {
			BootSyncSucc = 1
		}
		if exit {
			ExitSyncSucc = 1
		}
		writingDataLock.Unlock()
		return
	}
	writingDataLock.Unlock()

	cloudSyncVer, err := getCloudSyncVer(Conf.Sync.CloudName)
	if nil != err {
		msg := fmt.Sprintf(Conf.Language(24), err.Error())
		Conf.Sync.Stat = msg
		util.PushErrMsg(msg, 7000)
		if boot {
			BootSyncSucc = 1
		}
		if exit {
			ExitSyncSucc = 1
		}
		return
	}

	//util.LogInfof("sync [cloud=%d, local=%d]", cloudSyncVer, dataConf.SyncVer)
	if cloudSyncVer == dataConf.SyncVer {
		BootSyncSucc = 0
		ExitSyncSucc = 0
		syncSameCount++
		if 10 < syncSameCount {
			syncSameCount = 5
		}
		if !byHand {
			delay := time.Minute * time.Duration(int(math.Pow(2, float64(syncSameCount))))
			if fixSyncInterval.Minutes() > delay.Minutes() {
				delay = time.Minute * 8
			}
			planSyncAfter(delay)
		}

		Conf.Sync.Stat = Conf.Language(133)
		return
	}

	cloudUsedAssetSize, cloudUsedBackupSize, device, err := getCloudSync(Conf.Sync.CloudName)
	if nil != err {
		msg := fmt.Sprintf(Conf.Language(24), err.Error())
		Conf.Sync.Stat = msg
		util.PushErrMsg(msg, 7000)
		if boot {
			BootSyncSucc = 1
		}
		if exit {
			ExitSyncSucc = 1
		}
		return
	}

	localSyncDirPath := Conf.Sync.GetSaveDir()
	syncSameCount = 0
	if cloudSyncVer < dataConf.SyncVer {
		// 上传

		if -1 == cloudSyncVer {
			// 初次上传
			IncWorkspaceDataVer()
			incLocalSyncVer()
		}

		start := time.Now()
		//util.LogInfof("sync [cloud=%d, local=%d] uploading...", cloudSyncVer, dataConf.SyncVer)
		syncSize, err := util.SizeOfDirectory(localSyncDirPath, false)
		if nil != err {
			util.PushErrMsg(fmt.Sprintf(Conf.Language(80), formatErrorMsg(err)), 7000)
			return
		}

		leftSyncSize := int64(Conf.User.UserSiYuanRepoSize) - cloudUsedAssetSize - cloudUsedBackupSize
		if leftSyncSize < syncSize {
			util.PushErrMsg(fmt.Sprintf(Conf.Language(43), byteCountSI(int64(Conf.User.UserSiYuanRepoSize))), 7000)
			if boot {
				BootSyncSucc = 1
			}
			if exit {
				ExitSyncSucc = 1
			}
			return
		}

		wroteFiles, transferSize, err := ossUpload(false, localSyncDirPath, "sync/"+Conf.Sync.CloudName, device, boot)
		if nil != err {
			util.PushClearProgress()
			IncWorkspaceDataVer() // 上传失败的话提升本地版本，以备下次上传

			msg := fmt.Sprintf(Conf.Language(80), formatErrorMsg(err))
			Conf.Sync.Stat = msg
			util.PushErrMsg(msg, 7000)
			if boot {
				BootSyncSucc = 1
			}
			if exit {
				ExitSyncSucc = 1
			}
			return
		}

		util.PushClearProgress()
		elapsed := time.Now().Sub(start).Seconds()
		stat := fmt.Sprintf(Conf.Language(130), wroteFiles, humanize.Bytes(transferSize)) + fmt.Sprintf(Conf.Language(132), elapsed)
		util.LogInfof("sync [cloud=%d, local=%d, wroteFiles=%d, transferSize=%s] uploaded in [%.2fs]", cloudSyncVer, dataConf.SyncVer, wroteFiles, humanize.Bytes(transferSize), elapsed)

		Conf.Sync.Uploaded = now
		Conf.Sync.Stat = stat
		BootSyncSucc = 0
		ExitSyncSucc = 0
		if !byHand {
			planSyncAfter(fixSyncInterval)
		}
		return
	}

	// 下载

	if !boot && !exit {
		CloseWatchAssets()
		defer WatchAssets()
	}

	start := time.Now()
	//util.LogInfof("sync [cloud=%d, local=%d] downloading...", cloudSyncVer, dataConf.SyncVer)

	// 使用路径映射文件进行解密验证 https://github.com/siyuan-note/siyuan/issues/3789
	var tmpFetchedFiles int
	var tmpTransferSize uint64
	err = ossDownload0(util.TempDir+"/sync", "sync/"+Conf.Sync.CloudName, "/"+pathJSON, &tmpFetchedFiles, &tmpTransferSize, boot || exit)
	if nil != err {
		util.PushClearProgress()
		msg := fmt.Sprintf(Conf.Language(80), formatErrorMsg(err))
		Conf.Sync.Stat = msg
		util.PushErrMsg(msg, 7000)
		if boot {
			BootSyncSucc = 1
		}
		if exit {
			ExitSyncSucc = 1
		}
		syncDownloadErrCount++
		return
	}

	tmpPathJSON := filepath.Join(util.TempDir, "/sync/"+pathJSON)
	data, err := os.ReadFile(tmpPathJSON)
	if nil != err {
		return
	}
	data, err = encryption.AESGCMDecryptBinBytes(data, Conf.E2EEPasswd)
	if nil != err {
		util.PushClearProgress()
		msg := Conf.Language(28)
		Conf.Sync.Stat = msg
		util.PushErrMsg(fmt.Sprintf(Conf.Language(80), msg), 7000)
		if boot {
			BootSyncSucc = 1
		}
		if exit {
			ExitSyncSucc = 1
		}
		Conf.Sync.Stat = msg
		syncDownloadErrCount++
		return
	}

	fetchedFilesCount, transferSize, downloadedFiles, err := ossDownload(localSyncDirPath, "sync/"+Conf.Sync.CloudName, boot || exit)

	// 加上前面的路径映射文件统计
	fetchedFilesCount += tmpFetchedFiles
	transferSize += tmpTransferSize

	if nil != err {
		util.PushClearProgress()
		msg := fmt.Sprintf(Conf.Language(80), formatErrorMsg(err))
		Conf.Sync.Stat = msg
		util.PushErrMsg(msg, 7000)

		indexPath := filepath.Join(util.TempDir, "sync", "index.json")
		_, err = syncDirUpsertWorkspaceData(tmpPathJSON, indexPath, downloadedFiles)
		if nil != err {
			util.LogErrorf("upsert partially downloaded files to workspace data failed: %s", err)
		}

		if boot {
			BootSyncSucc = 1
		}
		if exit {
			ExitSyncSucc = 1
		}
		syncDownloadErrCount++
		return
	}
	util.PushClearProgress()

	// 恢复
	var upsertFiles, removeFiles []string
	if upsertFiles, removeFiles, err = syncDir2WorkspaceData(boot); nil != err {
		msg := fmt.Sprintf(Conf.Language(80), formatErrorMsg(err))
		Conf.Sync.Stat = msg
		util.PushErrMsg(msg, 7000)
		if boot {
			BootSyncSucc = 1
		}
		if exit {
			ExitSyncSucc = 1
		}
		syncDownloadErrCount++
		return
	}

	syncDownloadErrCount = 0

	// 清理空文件夹
	clearEmptyDirs(util.DataDir)

	elapsed := time.Now().Sub(start).Seconds()
	stat := fmt.Sprintf(Conf.Language(129), fetchedFilesCount, humanize.Bytes(transferSize)) + fmt.Sprintf(Conf.Language(131), elapsed)
	util.LogInfof("sync [cloud=%d, local=%d, fetchedFiles=%d, transferSize=%s] downloaded in [%.2fs]", cloudSyncVer, dataConf.SyncVer, fetchedFilesCount, humanize.Bytes(transferSize), elapsed)

	Conf.Sync.Downloaded = now
	Conf.Sync.Stat = stat
	BootSyncSucc = 0
	ExitSyncSucc = 0
	if !byHand {
		planSyncAfter(fixSyncInterval)
	}

	if boot && gulu.File.IsExist(util.BlockTreePath) {
		// 在 blocktree 存在的情况下不会重建索引，所以这里需要刷新 blocktree 和 database
		treenode.InitBlockTree()
		incReindex(upsertFiles, removeFiles)
		return
	}

	if !boot && !exit {
		incReindex(upsertFiles, removeFiles)
		cache.ClearDocsIAL() // 同步后文档树文档图标没有更新 https://github.com/siyuan-note/siyuan/issues/4939
		util.ReloadUI()
	}
	return
}

// TODO: 新版同步上线后移除
// 清理 dir 下符合 ID 规则的空文件夹。
// 因为是深度遍历，所以可能会清理不完全空文件夹，每次遍历仅能清理叶子节点。但是多次调用后，可以清理完全。
func clearEmptyDirs(dir string) {
	var emptyDirs []string
	filepath.Walk(dir, func(path string, info fs.FileInfo, err error) error {
		if nil != err || !info.IsDir() || dir == path {
			return err
		}

		if util.IsIDPattern(info.Name()) {
			if files, readDirErr := os.ReadDir(path); nil == readDirErr && 0 == len(files) {
				emptyDirs = append(emptyDirs, path)
			}
		}
		return nil
	})
	for _, emptyDir := range emptyDirs {
		if err := os.RemoveAll(emptyDir); nil != err {
			util.LogErrorf("clear empty dir [%s] failed [%s]", emptyDir, err.Error())
		}
	}
}

// incReindex 增量重建索引。
func incReindex(upserts, removes []string) {
	needPushUpsertProgress := 32 < len(upserts)
	needPushRemoveProgress := 32 < len(removes)

	for _, upsertFile := range upserts {
		if !strings.HasSuffix(upsertFile, ".sy") {
			continue
		}

		upsertFile = filepath.ToSlash(upsertFile)
		if strings.HasPrefix(upsertFile, "/") {
			upsertFile = upsertFile[1:]
		}
		idx := strings.Index(upsertFile, "/")
		if 0 > idx {
			// .sy 直接出现在 data 文件夹下，没有出现在笔记本文件夹下的情况
			continue
		}

		box := upsertFile[:idx]
		p := strings.TrimPrefix(upsertFile, box)
		tree, err0 := LoadTree(box, p)
		if nil != err0 {
			continue
		}
		treenode.ReindexBlockTree(tree)
		sql.UpsertTreeQueue(tree)
		msg := fmt.Sprintf("Sync reindex tree [%s]", tree.ID)
		util.PushStatusBar(msg)
		if needPushUpsertProgress {
			util.PushEndlessProgress(msg)
		}
	}
	for _, removeFile := range removes {
		if !strings.HasSuffix(removeFile, ".sy") {
			continue
		}

		id := strings.TrimSuffix(filepath.Base(removeFile), ".sy")
		block := treenode.GetBlockTree(id)
		if nil != block {
			treenode.RemoveBlockTreesByRootID(block.RootID)
			sql.RemoveTreeQueue(block.BoxID, block.RootID)
			msg := fmt.Sprintf("Sync remove tree [%s]", block.RootID)
			util.PushStatusBar(msg)
			if needPushRemoveProgress {
				util.PushEndlessProgress(msg)
			}
		}
	}

	if needPushRemoveProgress || needPushUpsertProgress {
		util.PushClearProgress()
	}
}

func SetCloudSyncDir(name string) {
	if Conf.Sync.CloudName == name {
		return
	}

	syncLock.Lock()
	defer syncLock.Unlock()

	Conf.Sync.CloudName = name
	Conf.Save()
}

func SetSyncEnable(b bool) (err error) {
	syncLock.Lock()
	defer syncLock.Unlock()

	Conf.Sync.Enabled = b
	Conf.Save()
	return
}

func SetSyncUseDataRepo(b bool) (err error) {
	syncLock.Lock()
	defer syncLock.Unlock()

	Conf.Sync.UseDataRepo = b
	Conf.Save()
	return
}

func SetSyncMode(mode int) (err error) {
	syncLock.Lock()
	defer syncLock.Unlock()

	Conf.Sync.Mode = mode
	Conf.Save()
	return
}

var syncLock = sync.Mutex{}

func syncDirUpsertWorkspaceData(metaPath, indexPath string, downloadedFiles map[string]bool) (upsertFiles []string, err error) {
	start := time.Now()

	modified := map[string]bool{}
	syncDir := Conf.Sync.GetSaveDir()
	for file, _ := range downloadedFiles {
		file = filepath.Join(syncDir, file)
		modified[file] = true
	}

	decryptedDataDir, upsertFiles, err := recoverSyncData(metaPath, indexPath, modified)
	if nil != err {
		util.LogErrorf("decrypt data dir failed: %s", err)
		return
	}

	dataDir := util.DataDir
	if err = stableCopy(decryptedDataDir, dataDir); nil != err {
		util.LogErrorf("copy decrypted data dir from [%s] to data dir [%s] failed: %s", decryptedDataDir, dataDir, err)
		return
	}
	if elapsed := time.Since(start).Milliseconds(); 5000 < elapsed {
		util.LogInfof("sync data to workspace data elapsed [%dms]", elapsed)
	}
	return
}

// syncDir2WorkspaceData 将 sync 的数据更新到 data 中。
//   1. 删除 data 中冗余的文件
//   2. 将 sync 中新增/修改的文件解密后拷贝到 data 中
func syncDir2WorkspaceData(boot bool) (upsertFiles, removeFiles []string, err error) {
	start := time.Now()
	unchanged, removeFiles, err := calcUnchangedSyncList()
	if nil != err {
		return
	}

	modified := modifiedSyncList(unchanged)
	metaPath := filepath.Join(util.TempDir, "sync", pathJSON) // 使用前面解密验证时下载的临时文件
	indexPath := filepath.Join(util.TempDir, "sync", "index.json")
	decryptedDataDir, upsertFiles, err := recoverSyncData(metaPath, indexPath, modified)
	if nil != err {
		util.LogErrorf("decrypt data dir failed: %s", err)
		return
	}

	if boot {
		util.IncBootProgress(0, "Copying decrypted data...")
	}

	dataDir := util.DataDir
	if err = stableCopy(decryptedDataDir, dataDir); nil != err {
		util.LogErrorf("copy decrypted data dir from [%s] to data dir [%s] failed: %s", decryptedDataDir, dataDir, err)
		return
	}
	if elapsed := time.Since(start).Milliseconds(); 5000 < elapsed {
		util.LogInfof("sync data to workspace data elapsed [%dms]", elapsed)
	}
	return
}

// workspaceData2SyncDir 将 data 的数据更新到 sync 中。
//   1. 删除 sync 中多余的文件
//   2. 将 data 中新增/修改的文件加密后拷贝到 sync 中
func workspaceData2SyncDir() (removeList, upsertList map[string]bool, err error) {
	start := time.Now()
	filelock.ReleaseAllFileLocks()

	passwd := Conf.E2EEPasswd
	unchangedDataList, removeList, err := calcUnchangedDataList(passwd)
	if nil != err {
		return
	}

	encryptedDataDir, upsertList, err := prepareSyncData(passwd, unchangedDataList)
	if nil != err {
		util.LogErrorf("encrypt data dir failed: %s", err)
		return
	}

	syncDir := Conf.Sync.GetSaveDir()
	if err = stableCopy(encryptedDataDir, syncDir); nil != err {
		util.LogErrorf("copy encrypted data dir from [%s] to sync dir [%s] failed: %s", encryptedDataDir, syncDir, err)
		return
	}
	if elapsed := time.Since(start).Milliseconds(); 5000 < elapsed {
		util.LogInfof("workspace data to sync data elapsed [%dms]", elapsed)
	}
	return
}

type CloudIndex struct {
	Hash    string `json:"hash"`
	Size    int64  `json:"size"`
	Updated int64  `json:"updated"` // Unix timestamp 秒
}

// genCloudIndex 生成云端索引文件。
func genCloudIndex(localDirPath string, excludes map[string]bool, calcHash bool) (cloudIndex map[string]*CloudIndex, err error) {
	cloudIndex = map[string]*CloudIndex{}
	err = filepath.Walk(localDirPath, func(path string, info fs.FileInfo, err error) error {
		if nil != err {
			return err
		}
		if localDirPath == path || info.IsDir() || excludes[path] {
			return nil
		}

		if util.CloudSingleFileMaxSizeLimit < info.Size() {
			return nil
		}

		p := strings.TrimPrefix(path, localDirPath)
		p = filepath.ToSlash(p)
		hash := ""
		if calcHash {
			var hashErr error
			hash, hashErr = util.GetEtag(path)
			if nil != hashErr {
				err = hashErr
				return io.EOF
			}
		}
		cloudIndex[p] = &CloudIndex{Hash: hash, Size: info.Size(), Updated: info.ModTime().Unix()}
		return nil
	})
	if nil != err {
		util.LogErrorf("walk sync dir [%s] failed: %s", localDirPath, err)
		return
	}
	data, err := gulu.JSON.MarshalJSON(cloudIndex)
	if nil != err {
		util.LogErrorf("marshal sync cloud index failed: %s", err)
		return
	}
	if err = gulu.File.WriteFileSafer(filepath.Join(localDirPath, "index.json"), data, 0644); nil != err {
		util.LogErrorf("write sync cloud index failed: %s", err)
		return
	}
	return
}

func recoverSyncData(metaPath, indexPath string, modified map[string]bool) (decryptedDataDir string, upsertFiles []string, err error) {
	passwd := Conf.E2EEPasswd
	decryptedDataDir = filepath.Join(util.TempDir, "incremental", "sync-decrypt")
	if err = os.RemoveAll(decryptedDataDir); nil != err {
		return
	}
	if err = os.MkdirAll(decryptedDataDir, 0755); nil != err {
		return
	}

	syncDir := Conf.Sync.GetSaveDir()
	data, err := os.ReadFile(metaPath)
	if nil != err {
		return
	}
	data, err = encryption.AESGCMDecryptBinBytes(data, passwd)
	if nil != err {
		err = errors.New(Conf.Language(40))
		return
	}

	metaJSON := map[string]string{}
	if err = gulu.JSON.UnmarshalJSON(data, &metaJSON); nil != err {
		return
	}

	index := map[string]*CloudIndex{}
	data, err = os.ReadFile(indexPath)
	if nil != err {
		return
	}
	if err = gulu.JSON.UnmarshalJSON(data, &index); nil != err {
		return
	}

	now := time.Now().Format("2006-01-02-150405")
	filepath.Walk(syncDir, func(path string, info fs.FileInfo, _ error) error {
		if syncDir == path || pathJSON == info.Name() {
			return nil
		}

		// 如果不是新增或者修改则跳过
		if !modified[path] {
			return nil
		}

		encryptedP := strings.TrimPrefix(path, syncDir+string(os.PathSeparator))
		encryptedP = filepath.ToSlash(encryptedP)
		if "" == metaJSON[encryptedP] {
			return nil
		}

		plainP := filepath.Join(decryptedDataDir, metaJSON[encryptedP])
		plainP = filepath.FromSlash(plainP)

		p := strings.TrimPrefix(plainP, decryptedDataDir+string(os.PathSeparator))
		upsertFiles = append(upsertFiles, p)
		dataPath := filepath.Join(util.DataDir, p)
		if gulu.File.IsExist(dataPath) && !gulu.File.IsDir(dataPath) { // 不是目录的话说明必定是已经存在的文件，这些文件被覆盖需要生成历史
			genSyncHistory(now, dataPath)
		}

		if info.IsDir() {
			if err = os.MkdirAll(plainP, 0755); nil != err {
				return io.EOF
			}
		} else {
			if err = os.MkdirAll(filepath.Dir(plainP), 0755); nil != err {
				return io.EOF
			}

			var err0 error
			data, err0 = os.ReadFile(path)
			if nil != err0 {
				util.LogErrorf("read file [%s] failed: %s", path, err0)
				err = err0
				return io.EOF
			}
			if !strings.HasPrefix(encryptedP, ".siyuan") {
				data, err0 = encryption.AESGCMDecryptBinBytes(data, passwd)
				if nil != err0 {
					util.LogErrorf("decrypt file [%s] failed: %s", path, err0)
					err = errors.New(Conf.Language(40))
					return io.EOF
				}
			}

			if err0 = gulu.File.WriteFileSafer(plainP, data, 0644); nil != err0 {
				util.LogErrorf("write file [%s] failed: %s", plainP, err0)
				err = err0
				return io.EOF
			}

			var modTime int64
			idx := index["/"+encryptedP]
			if nil == idx {
				util.LogErrorf("index file [%s] not found", encryptedP)
				modTime = info.ModTime().Unix()
			} else {
				modTime = idx.Updated
			}
			if err0 = os.Chtimes(plainP, time.Unix(modTime, 0), time.Unix(modTime, 0)); nil != err0 {
				util.LogErrorf("change file [%s] time failed: %s", plainP, err0)
			}
		}
		return nil
	})
	return
}

func prepareSyncData(passwd string, unchangedDataList map[string]bool) (encryptedDataDir string, upsertList map[string]bool, err error) {
	encryptedDataDir = filepath.Join(util.TempDir, "incremental", "sync-encrypt")
	if err = os.RemoveAll(encryptedDataDir); nil != err {
		return
	}
	if err = os.MkdirAll(encryptedDataDir, 0755); nil != err {
		return
	}

	ctime := map[string]time.Time{}
	meta := map[string]string{}
	filepath.Walk(util.DataDir, func(path string, info fs.FileInfo, _ error) error {
		if util.DataDir == path || nil == info {
			return nil
		}

		isDir := info.IsDir()
		if isCloudSkipFile(path, info) {
			if isDir {
				return filepath.SkipDir
			}
			return nil
		}

		plainP := strings.TrimPrefix(path, util.DataDir+string(os.PathSeparator))
		p := plainP

		if !strings.HasPrefix(plainP, ".siyuan") { // 配置目录下都用明文，其他文件需要映射文件名
			p = pathSha256Short(p, string(os.PathSeparator))
		}
		if !isDir {
			meta[filepath.ToSlash(p)] = filepath.ToSlash(plainP)
		}

		// 如果不是新增或者修改则跳过
		if unchangedDataList[path] {
			return nil
		}

		p = encryptedDataDir + string(os.PathSeparator) + p
		//util.LogInfof("update sync [%s] for data [%s]", p, path)
		if isDir {
			if err = os.MkdirAll(p, 0755); nil != err {
				return io.EOF
			}
		} else {
			if err = os.MkdirAll(filepath.Dir(p), 0755); nil != err {
				return io.EOF
			}

			data, err0 := filelock.NoLockFileRead(path)
			if nil != err0 {
				util.LogErrorf("read file [%s] failed: %s", path, err0)
				err = err0
				return io.EOF
			}
			if !strings.HasPrefix(plainP, ".siyuan") {
				data, err0 = encryption.AESGCMEncryptBinBytes(data, passwd)
				if nil != err0 {
					util.LogErrorf("encrypt file [%s] failed: %s", path, err0)
					err = errors.New("encrypt file failed")
					return io.EOF
				}
			}

			err0 = gulu.File.WriteFileSafer(p, data, 0644)
			if nil != err0 {
				util.LogErrorf("write file [%s] failed: %s", p, err0)
				err = err0
				return io.EOF
			}

			fi, err0 := os.Stat(path)
			if nil != err0 {
				util.LogErrorf("stat file [%s] failed: %s", path, err0)
				err = err0
				return io.EOF
			}
			ctime[p] = fi.ModTime()
		}
		return nil
	})
	if nil != err {
		return
	}

	for p, t := range ctime {
		if err = os.Chtimes(p, t, t); nil != err {
			return
		}
	}

	upsertList = map[string]bool{}
	// 检查文件是否全部已经编入索引
	err = filepath.Walk(encryptedDataDir, func(path string, info fs.FileInfo, _ error) error {
		if encryptedDataDir == path {
			return nil
		}

		if !info.IsDir() {
			path = strings.TrimPrefix(path, encryptedDataDir+string(os.PathSeparator))
			path = filepath.ToSlash(path)
			if _, ok := meta[path]; !ok {
				util.LogErrorf("not found sync path in meta [%s]", path)
				return errors.New(Conf.Language(27))
			}

			upsertList["/"+path] = true
		}
		return nil
	})
	if nil != err {
		return
	}

	data, err := gulu.JSON.MarshalJSON(meta)
	if nil != err {
		return
	}
	data, err = encryption.AESGCMEncryptBinBytes(data, passwd)
	if nil != err {
		util.LogErrorf("encrypt file failed: %s", err)
		return
	}
	if err = gulu.File.WriteFileSafer(filepath.Join(encryptedDataDir, pathJSON), data, 0644); nil != err {
		return
	}
	return
}

// modifiedSyncList 获取 sync 中新增和修改的文件列表。
func modifiedSyncList(unchangedList map[string]bool) (ret map[string]bool) {
	ret = map[string]bool{}
	syncDir := Conf.Sync.GetSaveDir()
	filepath.Walk(syncDir, func(path string, info fs.FileInfo, _ error) error {
		if syncDir == path || pathJSON == info.Name() {
			return nil
		}

		if !unchangedList[path] {
			ret[path] = true
		}
		return nil
	})
	return
}

// calcUnchangedSyncList 获取 data 和 sync 一致（没有修改过）的文件列表，并删除 data 中不存在于 sync 中的多余文件。
func calcUnchangedSyncList() (ret map[string]bool, removes []string, err error) {
	syncDir := Conf.Sync.GetSaveDir()
	meta := filepath.Join(syncDir, pathJSON)
	if !gulu.File.IsExist(meta) {
		return
	}
	data, err := os.ReadFile(meta)
	if nil != err {
		return
	}
	passwd := Conf.E2EEPasswd
	data, err = encryption.AESGCMDecryptBinBytes(data, passwd)
	if nil != err {
		err = errors.New(Conf.Language(40))
		return
	}

	metaJSON := map[string]string{}
	if err = gulu.JSON.UnmarshalJSON(data, &metaJSON); nil != err {
		return
	}

	excludes := getSyncExcludedList(syncDir)
	ret = map[string]bool{}
	sep := string(os.PathSeparator)
	filepath.Walk(util.DataDir, func(path string, info fs.FileInfo, _ error) error {
		if util.DataDir == path {
			return nil
		}

		if isCloudSkipFile(path, info) {
			if info.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}

		plainP := strings.TrimPrefix(path, util.DataDir+sep)
		dataP := plainP
		dataP = pathSha256Short(dataP, sep)
		syncP := filepath.Join(syncDir, dataP)

		if excludes[syncP] {
			return nil
		}

		if !gulu.File.IsExist(syncP) { //  sync 已经删除的文件
			removes = append(removes, path)
			if gulu.File.IsDir(path) {
				return filepath.SkipDir
			}
			return nil
		}

		stat, _ := os.Stat(syncP)
		syncModTime := stat.ModTime()
		if info.ModTime() == syncModTime {
			ret[syncP] = true
			return nil
		}
		return nil
	})

	// 在 data 中删除 sync 已经删除的文件
	now := time.Now().Format("2006-01-02-150405")
	for _, remove := range removes {
		genSyncHistory(now, remove)
		if ".siyuan" != filepath.Base(remove) {
			if err = os.RemoveAll(remove); nil != err {
				util.LogErrorf("remove [%s] failed: %s", remove, err)
			}
		}
	}
	return
}

// calcUnchangedDataList 计算 sync 和 data 一致（没有修改过）的文件列表 unchangedDataList，并删除 sync 中不存在于 data 中的多余文件 removeList。
func calcUnchangedDataList(passwd string) (unchangedDataList map[string]bool, removeList map[string]bool, err error) {
	syncDir := Conf.Sync.GetSaveDir()
	meta := filepath.Join(syncDir, pathJSON)
	if !gulu.File.IsExist(meta) {
		return
	}
	data, err := os.ReadFile(meta)
	if nil != err {
		return
	}
	data, err = encryption.AESGCMDecryptBinBytes(data, passwd)
	if nil != err {
		err = errors.New(Conf.Language(40))
		return
	}

	metaJSON := map[string]string{}
	if err = gulu.JSON.UnmarshalJSON(data, &metaJSON); nil != err {
		return
	}

	unchangedDataList = map[string]bool{}
	removeList = map[string]bool{}
	filepath.Walk(syncDir, func(path string, info fs.FileInfo, _ error) error {
		if syncDir == path || pathJSON == info.Name() || "index.json" == info.Name() || info.IsDir() {
			return nil
		}

		encryptedP := strings.TrimPrefix(path, syncDir+string(os.PathSeparator))
		encryptedP = filepath.ToSlash(encryptedP)
		decryptedP := metaJSON[encryptedP]
		if "" == decryptedP {
			removeList[path] = true
			if gulu.File.IsDir(path) {
				return filepath.SkipDir
			}
			return nil
		}
		dataP := filepath.Join(util.DataDir, decryptedP)
		dataP = filepath.FromSlash(dataP)
		if !gulu.File.IsExist(dataP) { // data 已经删除的文件
			removeList[path] = true
			if gulu.File.IsDir(path) {
				return filepath.SkipDir
			}
			return nil
		}

		stat, _ := os.Stat(dataP)
		dataModTime := stat.ModTime()
		if info.ModTime() == dataModTime {
			unchangedDataList[dataP] = true
			return nil
		}
		return nil
	})

	tmp := map[string]bool{}
	// 在 sync 中删除 data 中已经删除的文件
	for remove, _ := range removeList {
		if strings.HasSuffix(remove, "index.json") {
			continue
		}

		p := strings.TrimPrefix(remove, syncDir)
		p = filepath.ToSlash(p)
		tmp[p] = true

		if err = os.RemoveAll(remove); nil != err {
			util.LogErrorf("remove [%s] failed: %s", remove, err)
		}
	}
	removeList = tmp
	return
}

func getWorkspaceDataConf() (conf *filesys.DataConf, err error) {
	conf = &filesys.DataConf{Updated: util.CurrentTimeMillis(), Device: Conf.System.ID}
	confPath := filepath.Join(Conf.Sync.GetSaveDir(), ".siyuan", "conf.json")
	if !gulu.File.IsExist(confPath) {
		os.MkdirAll(filepath.Dir(confPath), 0755)
		data, _ := gulu.JSON.MarshalIndentJSON(conf, "", "  ")
		if err = filelock.NoLockFileWrite(confPath, data); nil != err {
			util.LogErrorf("save sync conf [%s] failed: %s", confPath, err)
		}
		return
	}

	data, err := filelock.NoLockFileRead(confPath)
	if nil != err {
		util.LogErrorf("read sync conf [%s] failed: %s", confPath, err)
		return
	}
	if err = gulu.JSON.UnmarshalJSON(data, conf); nil != err {
		filesys.IncWorkspaceDataVer(false, Conf.System.ID) // 尝试恢复 data/.siyuan/conf.json
		util.LogErrorf("unmarshal sync conf [%s] failed: %s", confPath, err)
		err = errors.New(Conf.Language(84))
		return
	}
	return
}

func incLocalSyncVer() {
	conf, err := getWorkspaceDataConf()
	if nil != err {
		return
	}

	conf.SyncVer++
	data, _ := gulu.JSON.MarshalIndentJSON(conf, "", "  ")
	confPath := filepath.Join(Conf.Sync.GetSaveDir(), ".siyuan", "conf.json")
	if err = gulu.File.WriteFileSafer(confPath, data, 0644); nil != err {
		util.LogErrorf("save sync conf [%s] failed: %s", confPath, err)
	}
	return
}

func isCloudSkipFile(path string, info os.FileInfo) bool {
	baseName := info.Name()
	if strings.HasPrefix(baseName, ".") {
		if ".siyuan" == baseName {
			return false
		}
		return true
	}
	if "history" == baseName {
		if strings.HasSuffix(path, ".siyuan"+string(os.PathSeparator)+"history") {
			return true
		}
	}

	if (os.ModeSymlink == info.Mode()&os.ModeType) || (!strings.Contains(path, ".siyuan") && gulu.File.IsHidden(path)) {
		return true
	}
	return false
}

func CreateCloudSyncDir(name string) (err error) {
	syncLock.Lock()
	defer syncLock.Unlock()

	name = strings.TrimSpace(name)
	name = gulu.Str.RemoveInvisible(name)
	if !IsValidCloudDirName(name) {
		return errors.New(Conf.Language(37))
	}

	if Conf.Sync.UseDataRepo {
		var cloudInfo *dejavu.CloudInfo
		cloudInfo, err = buildCloudInfo()
		if nil != err {
			return
		}

		err = dejavu.CreateCloudRepo(name, cloudInfo)
	} else {
		err = createCloudSyncDirOSS(name)
	}
	return
}

func RemoveCloudSyncDir(name string) (err error) {
	syncLock.Lock()
	defer syncLock.Unlock()

	if "" == name {
		return
	}

	if Conf.Sync.UseDataRepo {
		var cloudInfo *dejavu.CloudInfo
		cloudInfo, err = buildCloudInfo()
		if nil != err {
			return
		}

		err = dejavu.RemoveCloudRepo(name, cloudInfo)
	} else {
		err = removeCloudDirPath("sync/" + name)
	}

	if nil != err {
		return
	}

	if Conf.Sync.CloudName == name {
		Conf.Sync.CloudName = "main"
		Conf.Save()
		util.PushMsg(Conf.Language(155), 5000)
	}
	return
}

func ListCloudSyncDir() (syncDirs []*Sync, hSize string, err error) {
	syncDirs = []*Sync{}
	var dirs []map[string]interface{}
	var size int64
	if Conf.Sync.UseDataRepo {
		var cloudInfo *dejavu.CloudInfo
		cloudInfo, err = buildCloudInfo()
		if nil != err {
			return
		}

		dirs, size, err = dejavu.GetCloudRepos(cloudInfo)
	} else {
		dirs, size, err = listCloudSyncDirOSS()
	}
	if nil != err {
		return
	}

	for _, d := range dirs {
		dirSize := int64(d["size"].(float64))
		syncDirs = append(syncDirs, &Sync{
			Size:      dirSize,
			HSize:     humanize.Bytes(uint64(dirSize)),
			Updated:   d["updated"].(string),
			CloudName: d["name"].(string),
		})
	}
	hSize = humanize.Bytes(uint64(size))
	return
}

func genSyncHistory(now, p string) {
	dir := strings.TrimPrefix(p, util.DataDir+string(os.PathSeparator))
	if strings.Contains(dir, string(os.PathSeparator)) {
		dir = dir[:strings.Index(dir, string(os.PathSeparator))]
	}

	if ".siyuan" == dir || ".siyuan" == filepath.Base(p) {
		return
	}

	historyDir, err := util.GetHistoryDirNow(now, "sync")
	if nil != err {
		util.LogErrorf("get history dir failed: %s", err)
		return
	}

	relativePath := strings.TrimPrefix(p, util.DataDir)
	historyPath := filepath.Join(historyDir, relativePath)
	filelock.ReleaseFileLocks(p)
	if err = gulu.File.Copy(p, historyPath); nil != err {
		util.LogErrorf("gen sync history failed: %s", err)
		return
	}
}

func formatErrorMsg(err error) string {
	msg := err.Error()
	if strings.Contains(msg, "Permission denied") || strings.Contains(msg, "Access is denied") {
		msg = Conf.Language(33)
	} else if strings.Contains(msg, "Device or resource busy") {
		msg = Conf.Language(85)
	} else if strings.Contains(msg, "cipher: message authentication failed") {
		msg = Conf.Language(172)
	}
	msg = msg + " v" + util.Ver
	return msg
}

func IsValidCloudDirName(cloudDirName string) bool {
	if 16 < utf8.RuneCountInString(cloudDirName) || 1 > utf8.RuneCountInString(cloudDirName) {
		return false
	}

	chars := []byte{'~', '`', '!', '@', '#', '$', '%', '^', '&', '*', '(', ')', '+', '=',
		'[', ']', '{', '}', '\\', '|', ';', ':', '\'', '"', '<', ',', '>', '.', '?', '/', ' '}
	var charsStr string
	for _, char := range chars {
		charsStr += string(char)
	}

	if strings.ContainsAny(cloudDirName, charsStr) {
		return false
	}
	return true
}

func getSyncExcludedList(localDirPath string) (ret map[string]bool) {
	syncIgnoreList := getSyncIgnoreList()
	ret = map[string]bool{}
	for _, p := range syncIgnoreList {
		relPath := p
		relPath = pathSha256Short(relPath, "/")
		relPath = filepath.Join(localDirPath, relPath)
		ret[relPath] = true
	}
	return
}

func getSyncIgnoreList() (ret []string) {
	lines := getIgnoreLines()
	if 1 > len(lines) {
		return
	}

	gi := gitignore.CompileIgnoreLines(lines...)
	filepath.Walk(util.DataDir, func(p string, info os.FileInfo, err error) error {
		p = strings.TrimPrefix(p, util.DataDir+string(os.PathSeparator))
		p = filepath.ToSlash(p)
		if gi.MatchesPath(p) {
			ret = append(ret, p)
		}
		return nil
	})
	return
}

func getIgnoreLines() (ret []string) {
	ignore := filepath.Join(util.DataDir, ".siyuan", "syncignore")
	err := os.MkdirAll(filepath.Dir(ignore), 0755)
	if nil != err {
		return
	}
	if !gulu.File.IsExist(ignore) {
		if err = gulu.File.WriteFileSafer(ignore, nil, 0644); nil != err {
			util.LogErrorf("create syncignore [%s] failed: %s", ignore, err)
			return
		}
	}
	data, err := os.ReadFile(ignore)
	if nil != err {
		util.LogErrorf("read syncignore [%s] failed: %s", ignore, err)
		return
	}
	dataStr := string(data)
	dataStr = strings.ReplaceAll(dataStr, "\r\n", "\n")
	ret = strings.Split(dataStr, "\n")

	// 默认忽略帮助文档
	ret = append(ret, "20210808180117-6v0mkxr/**/*")
	ret = append(ret, "20210808180117-czj9bvb/**/*")
	ret = append(ret, "20211226090932-5lcq56f/**/*")

	ret = gulu.Str.RemoveDuplicatedElem(ret)
	return
}

func pathSha256Short(p, sep string) string {
	buf := bytes.Buffer{}
	parts := strings.Split(p, sep)
	for i, part := range parts {
		buf.WriteString(fmt.Sprintf("%x", sha256.Sum256([]byte(part)))[:7])
		if i < len(parts)-1 {
			buf.WriteString(sep)
		}
	}
	return buf.String()
}

func GetSyncDirection(cloudDirName string) (code int, msg string) { // 0：失败，10：上传，20：下载，30：一致，40：使用数据仓库同步
	if !IsSubscriber() {
		return
	}

	if "" == cloudDirName {
		return
	}

	if !IsValidCloudDirName(cloudDirName) {
		return
	}

	if Conf.Sync.UseDataRepo {
		return 40, ""
	}

	syncConf, err := getWorkspaceDataConf()
	if nil != err {
		msg = fmt.Sprintf(Conf.Language(80), formatErrorMsg(err))
		return
	}

	cloudSyncVer, err := getCloudSyncVer(cloudDirName)
	if nil != err {
		msg = fmt.Sprintf(Conf.Language(24), err.Error())
		return
	}
	if cloudSyncVer < syncConf.SyncVer {
		return 10, fmt.Sprintf(Conf.Language(89), cloudDirName) // 上传
	}
	if cloudSyncVer > syncConf.SyncVer {
		return 20, fmt.Sprintf(Conf.Language(90), cloudDirName) // 下载
	}
	return 30, fmt.Sprintf(Conf.Language(91), cloudDirName) // 一致
}

func IncWorkspaceDataVer() {
	filesys.IncWorkspaceDataVer(true, Conf.System.ID)
	syncSameCount = 0
	planSyncAfter(30 * time.Second)
}

func stableCopy(src, dest string) (err error) {
	if gulu.OS.IsWindows() {
		robocopy := "robocopy"
		cmd := exec.Command(robocopy, src, dest, "/DCOPY:T", "/E", "/IS", "/R:0", "/NFL", "/NDL", "/NJH", "/NJS", "/NP", "/NS", "/NC")
		util.CmdAttr(cmd)
		var output []byte
		output, err = cmd.CombinedOutput()
		if strings.Contains(err.Error(), "exit status 16") {
			// 某些版本的 Windows 无法同步 https://github.com/siyuan-note/siyuan/issues/4197
			return gulu.File.Copy(src, dest)
		}

		if nil != err && strings.Contains(err.Error(), exec.ErrNotFound.Error()) {
			robocopy = os.Getenv("SystemRoot") + "\\System32\\" + "robocopy"
			cmd = exec.Command(robocopy, src, dest, "/DCOPY:T", "/E", "/IS", "/R:0", "/NFL", "/NDL", "/NJH", "/NJS", "/NP", "/NS", "/NC")
			util.CmdAttr(cmd)
			output, err = cmd.CombinedOutput()
		}
		if nil == err ||
			strings.Contains(err.Error(), "exit status 3") ||
			strings.Contains(err.Error(), "exit status 1") ||
			strings.Contains(err.Error(), "exit status 2") ||
			strings.Contains(err.Error(), "exit status 5") ||
			strings.Contains(err.Error(), "exit status 6") ||
			strings.Contains(err.Error(), "exit status 7") {
			return nil
		}
		util.LogErrorf("robocopy data from [%s] to [%s] failed: %s %s", src, dest, string(output), err)
	}
	return gulu.File.Copy(src, dest)
}

func planSyncAfter(d time.Duration) {
	syncPlanTime = time.Now().Add(d)
}
