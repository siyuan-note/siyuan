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
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/88250/gulu"
	"github.com/dustin/go-humanize"
	"github.com/qiniu/go-sdk/v7/storage"
	"github.com/siyuan-note/dejavu"
	"github.com/siyuan-note/dejavu/entity"
	"github.com/siyuan-note/encryption"
	"github.com/siyuan-note/eventbus"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/httpclient"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func init() {
	subscribeEvents()
}

func GetRepoSnapshots(page int) (logs []*dejavu.Log, pageCount, totalCount int, err error) {
	if 1 > len(Conf.Repo.Key) {
		err = errors.New(Conf.Language(26))
		return
	}

	repo, err := newRepository()
	if nil != err {
		return
	}

	logs, pageCount, totalCount, err = repo.GetIndexLogs(page, 32)
	if nil != err {
		if dejavu.ErrNotFoundIndex == err {
			logs = []*dejavu.Log{}
			err = nil
			return
		}

		logging.LogErrorf("get data repo index logs failed: %s", err)
		return
	}
	return
}

func ImportRepoKey(base64Key string) (err error) {
	util.PushMsg(Conf.Language(136), 3000)

	base64Key = strings.TrimSpace(base64Key)
	base64Key = gulu.Str.RemoveInvisible(base64Key)
	if 1 > len(base64Key) {
		err = errors.New(Conf.Language(142))
		return
	}

	key, err := base64.StdEncoding.DecodeString(base64Key)
	if nil != err {
		logging.LogErrorf("import data repo key failed: %s", err)
		return errors.New(Conf.Language(157))
	}
	if 32 != len(key) {
		return errors.New(Conf.Language(157))
	}

	Conf.Repo.Key = key
	Conf.Save()

	if err = os.RemoveAll(Conf.Repo.GetSaveDir()); nil != err {
		return
	}
	if err = os.MkdirAll(Conf.Repo.GetSaveDir(), 0755); nil != err {
		return
	}

	time.Sleep(1 * time.Second)
	util.PushMsg(Conf.Language(138), 3000)
	time.Sleep(1 * time.Second)
	if initErr := IndexRepo("[Init] Init data repo"); nil != initErr {
		util.PushErrMsg(fmt.Sprintf(Conf.Language(140), initErr), 0)
	}
	return
}

func ResetRepo() (err error) {
	msgId := util.PushMsg(Conf.Language(144), 1000*60)

	if err = os.RemoveAll(Conf.Repo.GetSaveDir()); nil != err {
		return
	}
	if err = os.MkdirAll(Conf.Repo.GetSaveDir(), 0755); nil != err {
		return
	}

	Conf.Repo.Key = nil
	Conf.Save()

	util.PushUpdateMsg(msgId, Conf.Language(145), 3000)
	return
}

func InitRepoKeyFromPassphrase(passphrase string) (err error) {
	passphrase = gulu.Str.RemoveInvisible(passphrase)
	passphrase = strings.TrimSpace(passphrase)
	if "" == passphrase {
		return errors.New(Conf.Language(142))
	}

	util.PushMsg(Conf.Language(136), 3000)

	if err = os.RemoveAll(Conf.Repo.GetSaveDir()); nil != err {
		return
	}
	if err = os.MkdirAll(Conf.Repo.GetSaveDir(), 0755); nil != err {
		return
	}

	salt := fmt.Sprintf("%x", sha256.Sum256([]byte(passphrase)))[:16]
	key, err := encryption.KDF(passphrase, salt)
	if nil != err {
		logging.LogErrorf("init data repo key failed: %s", err)
		return
	}
	Conf.Repo.Key = key
	Conf.Save()

	time.Sleep(1 * time.Second)
	util.PushMsg(Conf.Language(138), 3000)
	time.Sleep(1 * time.Second)
	if initErr := IndexRepo("[Init] Init data repo"); nil != initErr {
		util.PushErrMsg(fmt.Sprintf(Conf.Language(140), initErr), 0)
	}
	return
}

func InitRepoKey() (err error) {
	util.PushMsg(Conf.Language(136), 3000)

	if err = os.RemoveAll(Conf.Repo.GetSaveDir()); nil != err {
		return
	}
	if err = os.MkdirAll(Conf.Repo.GetSaveDir(), 0755); nil != err {
		return
	}

	randomBytes := make([]byte, 16)
	_, err = rand.Read(randomBytes)
	if nil != err {
		return
	}
	password := string(randomBytes)
	randomBytes = make([]byte, 16)
	_, err = rand.Read(randomBytes)
	if nil != err {
		logging.LogErrorf("init data repo key failed: %s", err)
		return
	}
	salt := string(randomBytes)

	key, err := encryption.KDF(password, salt)
	if nil != err {
		logging.LogErrorf("init data repo key failed: %s", err)
		return
	}
	Conf.Repo.Key = key
	Conf.Save()

	time.Sleep(1 * time.Second)
	util.PushMsg(Conf.Language(138), 3000)
	time.Sleep(1 * time.Second)
	if initErr := IndexRepo("[Init] Init data repo"); nil != initErr {
		util.PushErrMsg(fmt.Sprintf(Conf.Language(140), initErr), 0)
	}
	return
}

func CheckoutRepo(id string) (err error) {
	if 1 > len(Conf.Repo.Key) {
		err = errors.New(Conf.Language(26))
		return
	}

	repo, err := newRepository()
	if nil != err {
		return
	}

	util.PushEndlessProgress(Conf.Language(63))
	writingDataLock.Lock()
	defer writingDataLock.Unlock()
	WaitForWritingFiles()
	sql.WaitForWritingDatabase()
	filelock.ReleaseAllFileLocks()
	CloseWatchAssets()
	defer WatchAssets()

	// 恢复快照时自动暂停同步，避免刚刚恢复后的数据又被同步覆盖
	syncEnabled := Conf.Sync.Enabled
	Conf.Sync.Enabled = false
	Conf.Save()

	_, _, err = repo.Checkout(id, map[string]interface{}{dejavu.CtxPushMsg: dejavu.CtxPushMsgToStatusBarAndProgress})
	if nil != err {
		util.PushClearProgress()
		return
	}

	RefreshFileTree()
	if syncEnabled {
		func() {
			time.Sleep(5 * time.Second)
			util.PushMsg(Conf.Language(134), 0)
		}()
	}
	return
}

func DownloadCloudSnapshot(tag, id string) (err error) {
	if 1 > len(Conf.Repo.Key) {
		err = errors.New(Conf.Language(26))
		return
	}

	repo, err := newRepository()
	if nil != err {
		return
	}

	cloudInfo, err := buildCloudInfo()
	if nil != err {
		return
	}

	defer util.PushClearProgress()
	downloadFileCount, downloadChunkCount, downloadBytes, err := repo.DownloadTagIndex(tag, id, cloudInfo, map[string]interface{}{dejavu.CtxPushMsg: dejavu.CtxPushMsgToStatusBarAndProgress})
	if nil != err {
		return
	}
	msg := fmt.Sprintf(Conf.Language(153), downloadFileCount, downloadChunkCount, humanize.Bytes(uint64(downloadBytes)))
	util.PushMsg(msg, 5000)
	util.PushStatusBar(msg)
	return
}

func UploadCloudSnapshot(tag, id string) (err error) {
	if 1 > len(Conf.Repo.Key) {
		err = errors.New(Conf.Language(26))
		return
	}

	repo, err := newRepository()
	if nil != err {
		return
	}

	cloudInfo, err := buildCloudInfo()
	if nil != err {
		return
	}

	util.PushEndlessProgress(Conf.Language(116))
	defer util.PushClearProgress()
	uploadFileCount, uploadChunkCount, uploadBytes, err := repo.UploadTagIndex(tag, id, cloudInfo, map[string]interface{}{dejavu.CtxPushMsg: dejavu.CtxPushMsgToStatusBarAndProgress})
	if nil != err {
		if errors.Is(err, dejavu.ErrCloudBackupCountExceeded) {
			err = fmt.Errorf(Conf.Language(84), Conf.Language(154))
			return
		}
		err = errors.New(fmt.Sprintf(Conf.Language(84), formatErrorMsg(err)))
		return
	}
	msg := fmt.Sprintf(Conf.Language(152), uploadFileCount, uploadChunkCount, humanize.Bytes(uint64(uploadBytes)))
	util.PushMsg(msg, 5000)
	util.PushStatusBar(msg)
	return
}

func RemoveCloudRepoTag(tag string) (err error) {
	if 1 > len(Conf.Repo.Key) {
		err = errors.New(Conf.Language(26))
		return
	}

	if "" == tag {
		err = errors.New("tag is empty")
		return
	}

	repo, err := newRepository()
	if nil != err {
		return
	}

	cloudInfo, err := buildCloudInfo()
	if nil != err {
		return
	}

	err = repo.RemoveCloudRepoTag(tag, cloudInfo, map[string]interface{}{dejavu.CtxPushMsg: dejavu.CtxPushMsgToStatusBar})
	if nil != err {
		return
	}
	return
}

func GetCloudRepoTagSnapshots() (ret []*dejavu.Log, err error) {
	if 1 > len(Conf.Repo.Key) {
		err = errors.New(Conf.Language(26))
		return
	}

	repo, err := newRepository()
	if nil != err {
		return
	}

	cloudInfo, err := buildCloudInfo()
	if nil != err {
		return
	}
	ret, err = repo.GetCloudRepoTagLogs(cloudInfo, map[string]interface{}{dejavu.CtxPushMsg: dejavu.CtxPushMsgToStatusBar})
	if 1 > len(ret) {
		ret = []*dejavu.Log{}
	}
	return
}

func GetTagSnapshots() (ret []*dejavu.Log, err error) {
	if 1 > len(Conf.Repo.Key) {
		err = errors.New(Conf.Language(26))
		return
	}

	repo, err := newRepository()
	if nil != err {
		return
	}

	ret, err = repo.GetTagLogs()
	if 1 > len(ret) {
		ret = []*dejavu.Log{}
	}
	return
}

func RemoveTagSnapshot(tag string) (err error) {
	if 1 > len(Conf.Repo.Key) {
		err = errors.New(Conf.Language(26))
		return
	}

	repo, err := newRepository()
	if nil != err {
		return
	}

	err = repo.RemoveTag(tag)
	return
}

func TagSnapshot(id, name string) (err error) {
	if 1 > len(Conf.Repo.Key) {
		err = errors.New(Conf.Language(26))
		return
	}

	name = gulu.Str.RemoveInvisible(name)
	if "" == name {
		err = errors.New(Conf.Language(142))
		return
	}

	if !gulu.File.IsValidFilename(name) {
		err = errors.New(Conf.Language(151))
		return
	}

	repo, err := newRepository()
	if nil != err {
		return
	}

	index, err := repo.GetIndex(id)
	if nil != err {
		return
	}

	if err = repo.AddTag(index.ID, name); nil != err {
		msg := fmt.Sprintf("Add tag to data snapshot [%s] failed: %s", index.ID, err)
		util.PushStatusBar(msg)
		return
	}
	return
}

func IndexRepo(memo string) (err error) {
	if 1 > len(Conf.Repo.Key) {
		err = errors.New(Conf.Language(26))
		return
	}

	memo = gulu.Str.RemoveInvisible(memo)
	if "" == memo {
		err = errors.New(Conf.Language(142))
		return
	}

	repo, err := newRepository()
	if nil != err {
		return
	}

	util.PushEndlessProgress(Conf.Language(143))

	start := time.Now()
	latest, _ := repo.Latest()
	WaitForWritingFiles()
	filelock.ReleaseAllFileLocks()
	index, err := repo.Index(memo, map[string]interface{}{
		dejavu.CtxPushMsg: dejavu.CtxPushMsgToStatusBarAndProgress,
	})
	if nil != err {
		util.PushStatusBar("Index data repo failed: " + err.Error())
		return
	}
	elapsed := time.Since(start)

	if nil == latest || latest.ID != index.ID {
		msg := fmt.Sprintf(Conf.Language(147), elapsed.Seconds())
		util.PushStatusBar(msg)
		util.PushMsg(msg, 5000)
	} else {
		msg := fmt.Sprintf(Conf.Language(148), elapsed.Seconds())
		util.PushStatusBar(msg)
		util.PushMsg(msg, 5000)
	}
	util.PushClearProgress()
	return
}

func syncRepo(boot, exit, byHand bool) (err error) {
	if 1 > len(Conf.Repo.Key) {
		syncDownloadErrCount++
		planSyncAfter(fixSyncInterval)

		msg := Conf.Language(26)
		util.PushStatusBar(msg)
		util.PushErrMsg(msg, 0)
		return
	}

	repo, err := newRepository()
	if nil != err {
		syncDownloadErrCount++
		planSyncAfter(fixSyncInterval)

		msg := fmt.Sprintf("sync repo failed: %s", err)
		logging.LogErrorf(msg)
		util.PushStatusBar(msg)
		util.PushErrMsg(msg, 0)
		return
	}

	start := time.Now()
	indexBeforeSync, err := indexRepoBeforeCloudSync(repo)
	if nil != err {
		syncDownloadErrCount++
		planSyncAfter(fixSyncInterval)
		return
	}

	cloudInfo, err := buildCloudInfo()
	if nil != err {
		return
	}

	syncContext := map[string]interface{}{dejavu.CtxPushMsg: dejavu.CtxPushMsgToStatusBar}
	_, mergeResult, trafficStat, err := repo.Sync(cloudInfo, syncContext)
	elapsed := time.Since(start)
	if nil != err {
		syncDownloadErrCount++
		planSyncAfter(fixSyncInterval)

		logging.LogErrorf("sync data repo failed: %s", err)
		msg := fmt.Sprintf(Conf.Language(80), formatErrorMsg(err))
		if errors.Is(err, dejavu.ErrCloudStorageSizeExceeded) {
			msg = fmt.Sprintf(Conf.Language(43), humanize.Bytes(uint64(Conf.User.UserSiYuanRepoSize)))
		}
		Conf.Sync.Stat = msg
		util.PushStatusBar(msg)
		util.PushErrMsg(msg, 0)
		if boot {
			BootSyncSucc = 1
		}
		if exit {
			ExitSyncSucc = 1
		}
		return
	}
	util.PushStatusBar(fmt.Sprintf(Conf.Language(149), elapsed.Seconds()))
	Conf.Sync.Synced = util.CurrentTimeMillis()
	msg := fmt.Sprintf(Conf.Language(150), trafficStat.UploadFileCount, trafficStat.DownloadFileCount, trafficStat.UploadChunkCount, trafficStat.DownloadChunkCount, humanize.Bytes(uint64(trafficStat.UploadBytes)), humanize.Bytes(uint64(trafficStat.DownloadBytes)))
	Conf.Sync.Stat = msg
	syncDownloadErrCount = 0
	logging.LogInfof("synced data repo [ufc=%d, dfc=%d, ucc=%d, dcc=%d, ub=%s, db=%s] in [%.2fs]",
		trafficStat.UploadFileCount, trafficStat.DownloadFileCount, trafficStat.UploadChunkCount, trafficStat.DownloadChunkCount, humanize.Bytes(uint64(trafficStat.UploadBytes)), humanize.Bytes(uint64(trafficStat.DownloadBytes)), elapsed.Seconds())

	if 1 > len(mergeResult.Upserts) && 1 > len(mergeResult.Removes) { // 没有数据变更
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
		util.PushClearProgress()
		return
	}

	// 有数据变更，需要重建索引
	var upserts, removes []string
	for _, file := range mergeResult.Upserts {
		upserts = append(upserts, file.Path)
	}
	for _, file := range mergeResult.Removes {
		removes = append(removes, file.Path)
	}

	if boot && gulu.File.IsExist(util.BlockTreePath) {
		treenode.InitBlockTree()
	}

	cache.ClearDocsIAL() // 同步后文档树文档图标没有更新 https://github.com/siyuan-note/siyuan/issues/4939

	fullReindex := 0.2 < float64(len(upserts))/float64(len(indexBeforeSync.Files))
	if fullReindex {
		RefreshFileTree()
		return
	}
	incReindex(upserts, removes)

	if !boot && !exit {
		util.ReloadUI()
	}

	elapsed = time.Since(start)
	if !exit {
		go func() {
			time.Sleep(2 * time.Second)
			util.PushStatusBar(fmt.Sprintf(Conf.Language(149), elapsed.Seconds()))
		}()
	}
	return
}

func indexRepoBeforeCloudSync(repo *dejavu.Repo) (index *entity.Index, err error) {
	start := time.Now()
	latest, _ := repo.Latest()
	index, err = repo.Index("[Sync] Cloud sync", map[string]interface{}{
		dejavu.CtxPushMsg: dejavu.CtxPushMsgToStatusBar,
	})
	if nil != err {
		msg := fmt.Sprintf(Conf.Language(140), formatErrorMsg(err))
		util.PushStatusBar(msg)
		util.PushErrMsg(msg, 12000)
		logging.LogErrorf("index data repo before cloud sync failed: %s", err)
		return
	}
	elapsed := time.Since(start)

	if nil == latest || latest.ID != index.ID {
		// 对新创建的快照需要更新备注，加入耗时统计
		index.Memo = fmt.Sprintf("[Sync] Cloud sync, completed in %.2fs", elapsed.Seconds())
		if err = repo.PutIndex(index); nil != err {
			util.PushStatusBar("Save data snapshot for cloud sync failed")
			logging.LogErrorf("put index into data repo before cloud sync failed: %s", err)
			return
		}
		util.PushStatusBar(fmt.Sprintf(Conf.Language(147), elapsed.Seconds()))
	} else {
		util.PushStatusBar(fmt.Sprintf(Conf.Language(148), elapsed.Seconds()))
	}

	if 7000 < elapsed.Milliseconds() {
		logging.LogWarnf("index data repo before cloud sync elapsed [%dms]", elapsed.Milliseconds())
	}
	return
}

func newRepository() (ret *dejavu.Repo, err error) {
	ignoreLines := getIgnoreLines()
	ignoreLines = append(ignoreLines, "/.siyuan/conf.json") // 忽略旧版同步配置
	ret, err = dejavu.NewRepo(util.DataDir, util.RepoDir, util.HistoryDir, util.TempDir, Conf.Repo.Key, ignoreLines)
	if nil != err {
		logging.LogErrorf("init data repo failed: %s", err)
	}
	return
}

func subscribeEvents() {
	eventbus.Subscribe(dejavu.EvtIndexBeforeWalkData, func(context map[string]interface{}, path string) {
		msg := fmt.Sprintf(Conf.Language(158), path)
		util.SetBootDetails(msg)
		contextPushMsg(context, msg)
	})

	indexWalkDataCount := 0
	eventbus.Subscribe(dejavu.EvtIndexWalkData, func(context map[string]interface{}, path string) {
		msg := fmt.Sprintf(Conf.Language(158), filepath.Base(path))
		if 0 == indexWalkDataCount%512 {
			util.SetBootDetails(msg)
			contextPushMsg(context, msg)
		}
		indexWalkDataCount++
	})
	eventbus.Subscribe(dejavu.EvtIndexBeforeGetLatestFiles, func(context map[string]interface{}, files []string) {
		msg := fmt.Sprintf(Conf.Language(159), len(files))
		util.SetBootDetails(msg)
		contextPushMsg(context, msg)
	})
	getLatestFileCount := 0
	eventbus.Subscribe(dejavu.EvtIndexGetLatestFile, func(context map[string]interface{}, id string) {
		msg := fmt.Sprintf(Conf.Language(159), id[:7])
		if 0 == getLatestFileCount%512 {
			util.SetBootDetails(msg)
			contextPushMsg(context, msg)
		}
		getLatestFileCount++
	})
	eventbus.Subscribe(dejavu.EvtIndexUpsertFiles, func(context map[string]interface{}, files []*entity.File) {
		msg := fmt.Sprintf(Conf.Language(160), len(files))
		util.SetBootDetails(msg)
		contextPushMsg(context, msg)
	})
	indexUpsertFileCount := 0
	eventbus.Subscribe(dejavu.EvtIndexUpsertFile, func(context map[string]interface{}, path string) {
		msg := fmt.Sprintf(Conf.Language(160), filepath.Base(path))
		if 0 == indexUpsertFileCount%128 {
			util.SetBootDetails(msg)
			contextPushMsg(context, msg)
		}
		indexUpsertFileCount++
	})

	eventbus.Subscribe(dejavu.EvtCheckoutBeforeWalkData, func(context map[string]interface{}, path string) {
		msg := fmt.Sprintf(Conf.Language(161), path)
		util.SetBootDetails(msg)
		contextPushMsg(context, msg)
	})
	coWalkDataCount := 0
	eventbus.Subscribe(dejavu.EvtCheckoutWalkData, func(context map[string]interface{}, path string) {
		msg := fmt.Sprintf(Conf.Language(161), filepath.Base(path))
		if 0 == coWalkDataCount%512 {
			util.SetBootDetails(msg)
			contextPushMsg(context, msg)
		}
		coWalkDataCount++
	})
	var bootProgressPart float64
	eventbus.Subscribe(dejavu.EvtCheckoutUpsertFiles, func(context map[string]interface{}, files []*entity.File) {
		msg := fmt.Sprintf(Conf.Language(162), len(files))
		util.SetBootDetails(msg)
		bootProgressPart = 10 / float64(len(files))
		contextPushMsg(context, msg)
	})
	coUpsertFileCount := 0
	eventbus.Subscribe(dejavu.EvtCheckoutUpsertFile, func(context map[string]interface{}, path string) {
		msg := fmt.Sprintf(Conf.Language(162), filepath.Base(path))
		util.IncBootProgress(bootProgressPart, msg)
		if 0 == coUpsertFileCount%128 {
			contextPushMsg(context, msg)
		}
		coUpsertFileCount++
	})
	eventbus.Subscribe(dejavu.EvtCheckoutRemoveFiles, func(context map[string]interface{}, files []*entity.File) {
		msg := fmt.Sprintf(Conf.Language(163), files)
		util.SetBootDetails(msg)
		bootProgressPart = 10 / float64(len(files))
		contextPushMsg(context, msg)
	})
	coRemoveFileCount := 0
	eventbus.Subscribe(dejavu.EvtCheckoutRemoveFile, func(context map[string]interface{}, path string) {
		msg := fmt.Sprintf(Conf.Language(163), filepath.Base(path))
		util.IncBootProgress(bootProgressPart, msg)
		if 0 == coRemoveFileCount%512 {
			contextPushMsg(context, msg)
		}
		coRemoveFileCount++
	})

	eventbus.Subscribe(dejavu.EvtCloudBeforeDownloadIndex, func(context map[string]interface{}, id string) {
		msg := fmt.Sprintf(Conf.Language(164), id[:7])
		util.IncBootProgress(1, msg)
		contextPushMsg(context, msg)
	})

	eventbus.Subscribe(dejavu.EvtCloudBeforeDownloadFiles, func(context map[string]interface{}, ids []string) {
		msg := fmt.Sprintf(Conf.Language(165), len(ids))
		util.SetBootDetails(msg)
		bootProgressPart = 10 / float64(len(ids))
		contextPushMsg(context, msg)
	})
	downloadFileCount := 0
	eventbus.Subscribe(dejavu.EvtCloudBeforeDownloadFile, func(context map[string]interface{}, id string) {
		msg := fmt.Sprintf(Conf.Language(165), id[:7])
		util.IncBootProgress(bootProgressPart, msg)
		if 0 == downloadFileCount%8 {
			contextPushMsg(context, msg)
		}
		downloadFileCount++
	})
	eventbus.Subscribe(dejavu.EvtCloudBeforeDownloadChunks, func(context map[string]interface{}, ids []string) {
		msg := fmt.Sprintf(Conf.Language(166), len(ids))
		util.SetBootDetails(msg)
		bootProgressPart = 10 / float64(len(ids))
		contextPushMsg(context, msg)
	})
	downloadChunkCount := 0
	eventbus.Subscribe(dejavu.EvtCloudBeforeDownloadChunk, func(context map[string]interface{}, id string) {
		msg := fmt.Sprintf(Conf.Language(166), id[:7])
		util.IncBootProgress(bootProgressPart, msg)
		if 0 == downloadChunkCount%8 {
			contextPushMsg(context, msg)
		}
		downloadChunkCount++
	})
	eventbus.Subscribe(dejavu.EvtCloudBeforeDownloadRef, func(context map[string]interface{}, ref string) {
		msg := fmt.Sprintf(Conf.Language(167), ref)
		util.IncBootProgress(1, msg)
		contextPushMsg(context, msg)
	})
	eventbus.Subscribe(dejavu.EvtCloudBeforeUploadIndex, func(context map[string]interface{}, id string) {
		msg := fmt.Sprintf(Conf.Language(168), id[:7])
		util.IncBootProgress(1, msg)
		contextPushMsg(context, msg)
	})
	eventbus.Subscribe(dejavu.EvtCloudBeforeUploadFiles, func(context map[string]interface{}, files []*entity.File) {
		msg := fmt.Sprintf(Conf.Language(169), len(files))
		util.SetBootDetails(msg)
		contextPushMsg(context, msg)
	})
	uploadFileCount := 0
	eventbus.Subscribe(dejavu.EvtCloudBeforeUploadFile, func(context map[string]interface{}, id string) {
		msg := fmt.Sprintf(Conf.Language(169), id[:7])
		if 0 == uploadFileCount%8 {
			util.SetBootDetails(msg)
			contextPushMsg(context, msg)
		}
		uploadFileCount++
	})
	eventbus.Subscribe(dejavu.EvtCloudBeforeUploadChunks, func(context map[string]interface{}, ids []string) {
		msg := fmt.Sprintf(Conf.Language(170), len(ids))
		util.SetBootDetails(msg)
		contextPushMsg(context, msg)
	})
	uploadChunkCount := 0
	eventbus.Subscribe(dejavu.EvtCloudBeforeUploadChunk, func(context map[string]interface{}, id string) {
		msg := fmt.Sprintf(Conf.Language(170), id[:7])
		if 0 == uploadChunkCount%8 {
			util.SetBootDetails(msg)
			contextPushMsg(context, msg)
		}
		uploadChunkCount++
	})
	eventbus.Subscribe(dejavu.EvtCloudBeforeUploadRef, func(context map[string]interface{}, ref string) {
		msg := fmt.Sprintf(Conf.Language(171), ref)
		util.SetBootDetails(msg)
		contextPushMsg(context, msg)
	})
}

func contextPushMsg(context map[string]interface{}, msg string) {
	switch context[dejavu.CtxPushMsg].(int) {
	case dejavu.CtxPushMsgToProgress:
		util.PushEndlessProgress(msg)
	case dejavu.CtxPushMsgToStatusBar:
		util.PushStatusBar(msg)
	case dejavu.CtxPushMsgToStatusBarAndProgress:
		util.PushStatusBar(msg)
		util.PushEndlessProgress(msg)
	}
}

func buildCloudInfo() (ret *dejavu.CloudInfo, err error) {
	if !IsValidCloudDirName(Conf.Sync.CloudName) {
		logging.LogWarnf("invalid cloud repo name, rename it to [main]")
		Conf.Sync.CloudName = "main"
		Conf.Save()
	}

	if nil == Conf.User {
		err = errors.New("user auth failed")
		return
	}

	ret = &dejavu.CloudInfo{
		Dir:       Conf.Sync.CloudName,
		UserID:    Conf.User.UserId,
		Token:     Conf.User.UserToken,
		LimitSize: int64(Conf.User.UserSiYuanRepoSize - Conf.User.UserSiYuanAssetSize),
		Server:    util.AliyunServer,
		Zone:      &storage.ZoneHuadong, // TODO: 海外版需要条件编译
	}
	return
}

type Backup struct {
	Size    int64  `json:"size"`
	HSize   string `json:"hSize"`
	Updated string `json:"updated"`
	SaveDir string `json:"saveDir"` // 本地备份数据存放目录路径
}

type Sync struct {
	Size      int64  `json:"size"`
	HSize     string `json:"hSize"`
	Updated   string `json:"updated"`
	CloudName string `json:"cloudName"` // 云端同步数据存放目录名
	SaveDir   string `json:"saveDir"`   // 本地同步数据存放目录路径
}

func GetCloudSpace() (s *Sync, b *Backup, hSize, hAssetSize, hTotalSize string, err error) {
	sync, backup, assetSize, err := getCloudSpaceOSS()
	if nil != err {
		err = errors.New(Conf.Language(30) + " " + err.Error())
		return
	}

	var totalSize, syncSize, backupSize int64
	var syncUpdated, backupUpdated string
	if nil != sync {
		syncSize = int64(sync["size"].(float64))
		syncUpdated = sync["updated"].(string)
	}
	s = &Sync{
		Size:    syncSize,
		HSize:   humanize.Bytes(uint64(syncSize)),
		Updated: syncUpdated,
	}

	if nil != backup {
		backupSize = int64(backup["size"].(float64))
		backupUpdated = backup["updated"].(string)
	}
	b = &Backup{
		Size:    backupSize,
		HSize:   humanize.Bytes(uint64(backupSize)),
		Updated: backupUpdated,
	}
	totalSize = syncSize + backupSize + assetSize
	hAssetSize = humanize.Bytes(uint64(assetSize))
	hSize = humanize.Bytes(uint64(totalSize))
	hTotalSize = humanize.Bytes(uint64(Conf.User.UserSiYuanRepoSize))
	return
}

func getCloudSpaceOSS() (sync, backup map[string]interface{}, assetSize int64, err error) {
	result := map[string]interface{}{}
	resp, err := httpclient.NewCloudRequest().
		SetResult(&result).
		SetBody(map[string]string{"token": Conf.User.UserToken}).
		Post(util.AliyunServer + "/apis/siyuan/dejavu/getRepoStat?uid=" + Conf.User.UserId)

	if nil != err {
		logging.LogErrorf("get cloud space failed: %s", err)
		err = ErrFailedToConnectCloudServer
		return
	}

	if 401 == resp.StatusCode {
		err = errors.New(Conf.Language(31))
		return
	}

	code := result["code"].(float64)
	if 0 != code {
		logging.LogErrorf("get cloud space failed: %s", result["msg"])
		err = errors.New(result["msg"].(string))
		return
	}

	data := result["data"].(map[string]interface{})
	sync = data["sync"].(map[string]interface{})
	backup = data["backup"].(map[string]interface{})
	assetSize = int64(data["assetSize"].(float64))
	return
}
