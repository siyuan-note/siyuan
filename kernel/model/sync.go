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

package model

import (
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/88250/go-humanize"
	"github.com/88250/gulu"
	"github.com/88250/lute/html"
	"github.com/gorilla/websocket"
	"github.com/siyuan-note/dejavu"
	"github.com/siyuan-note/dejavu/cloud"
	"github.com/siyuan-note/eventbus"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func SyncDataDownload() {
	defer logging.Recover()

	if !checkSync(false, false, true) {
		return
	}

	scope := lanSyncScope()
	latestID := getSyncCloudLatestID()
	if "" != latestID {
		_, _ = syncRemoteRequests.do(scope, latestID, func() error {
			lockSync()
			defer unlockSync()
			if syncRemoteRequests.isCompleted(scope, latestID) {
				return nil
			}
			err := syncDataDownloadLocked()
			if nil == err {
				completeCurrentSyncRemoteRequest(scope)
			}
			return err
		})
		return
	}

	unlock, ok := lockSyncRequest(&syncDownloadRequests)
	if !ok {
		return
	}
	defer unlock()
	if err := syncDataDownloadLocked(); nil == err {
		completeCurrentSyncRemoteRequest(scope)
	}
}

func syncDataDownloadLocked() (err error) {
	util.BroadcastByType("main", "syncing", 0, Conf.Language(81), nil)

	now := util.CurrentTimeMillis()
	Conf.Sync.Synced = now

	err = syncRepoDownloadWithDNSRetry()
	code := 1
	if err != nil {
		code = 2
	}
	util.BroadcastByType("main", "syncing", code, Conf.Sync.Stat, nil)
	if 1 == code {
		consumeShorthands()
	}
	return
}

func getSyncCloudLatestID() (ret string) {
	// 同步感知消息不包含云端提交 ID，需要先读取最新索引，以便和局域网提交提示使用同一个去重键。
	repo, err := newSyncRepository()
	if nil != err {
		logging.LogWarnf("create repo before perceived sync failed: %s", err)
		return
	}
	syncContext := map[string]any{eventbus.CtxPushMsg: eventbus.CtxPushMsgToNone}
	latest, err := repo.GetCloudLatestFast(syncContext)
	if nil != err {
		logging.LogWarnf("get cloud latest before perceived sync failed: %s", err)
		return
	}
	if nil != latest {
		ret = latest.ID
	}
	return
}

func completeCurrentSyncRemoteRequest(scope string) {
	// 完整同步可能在合并本地变更后生成新的最新索引，同时记录实际结果可覆盖两类通知到达顺序相反的情况。
	repo, err := newRepository()
	if nil != err {
		logging.LogWarnf("create repo after remote sync failed: %s", err)
		return
	}
	latest, err := repo.Latest()
	if nil != err {
		logging.LogWarnf("get local latest after remote sync failed: %s", err)
		return
	}
	syncRemoteRequests.complete(scope, latest.ID)
}

func SyncDataUpload() {
	defer logging.Recover()

	if !checkSync(false, false, true) {
		return
	}

	unlock, ok := lockSyncRequest(&syncUploadRequests)
	if !ok {
		return
	}
	defer unlock()
	util.BroadcastByType("main", "syncing", 0, Conf.Language(81), nil)

	now := util.CurrentTimeMillis()
	Conf.Sync.Synced = now

	err := syncRepoUploadWithDNSRetry()
	code := 1
	if err != nil {
		code = 2
	}
	util.BroadcastByType("main", "syncing", code, Conf.Sync.Stat, nil)
	return
}

var (
	syncSameCount    = atomic.Int32{}
	autoSyncErrCount = 0
	fixSyncInterval  = 5 * time.Minute

	syncPlanTimeLock = sync.Mutex{}
	syncPlanTime     = time.Now().Add(fixSyncInterval)

	BootSyncSucc = -1 // -1：未执行，0：执行成功，1：执行失败
	ExitSyncSucc = -1
)

func SyncDataJob() {
	syncPlanTimeLock.Lock()
	if time.Now().Before(syncPlanTime) {
		syncPlanTimeLock.Unlock()
		return
	}
	syncPlanTimeLock.Unlock()

	SyncData(false)
}

func BootSyncData() {
	defer logging.Recover()
	refreshLANSyncManager()

	if Conf.Sync.Perception {
		connectSyncWebSocket()
	}

	if !checkSync(true, false, false) {
		return
	}

	lockSync()
	defer unlockSync()

	util.IncBootProgress(3, Conf.Language(307))
	BootSyncSucc = 0
	logging.LogInfof("sync before boot")

	now := util.CurrentTimeMillis()
	Conf.Sync.Synced = now
	util.BroadcastByType("main", "syncing", 0, Conf.Language(81), nil)
	err := bootSyncRepoWithDNSRetry()
	code := 1
	if err != nil {
		code = 2
	}
	util.BroadcastByType("main", "syncing", code, Conf.Sync.Stat, nil)
	if 1 == code {
		// 启动同步成功后消费本地速记临时文件，避免移动端开启云同步时需手动触发同步才能刷新闪念速记
		consumeShorthands()
	}
	return
}

func SyncData(byHand bool) {
	syncData(false, byHand)
}

// SyncDataBeforeEnableEncryptedNotebook 在启用加密笔记本前执行一次完整同步。
// 未启用数据同步时直接返回；已启用数据同步时，任何同步失败都会阻止继续创建新的密钥体系。
func SyncDataBeforeEnableEncryptedNotebook() error {
	if !Conf.Sync.Enabled {
		return nil
	}
	if !cloud.IsValidCloudDirName(Conf.Sync.CloudName) {
		return errors.New(Conf.Language(123))
	}
	if !checkSync(false, false, true) {
		return errors.New(Conf.Language(53))
	}

	// 不复用请求合并状态，确保调用返回前确实完成了一次由当前启用操作发起的完整同步。
	lockSync()
	defer unlockSync()
	if err := syncDataLocked(false, true); err != nil {
		if Conf.Sync.Stat != "" {
			return errors.New(Conf.Sync.Stat)
		}
		return err
	}
	return nil
}

func lockSync() {
	syncLock.Lock()
	isSyncing.Store(true)
}

func unlockSync() {
	isSyncing.Store(false)
	syncLock.Unlock()
}

type syncRequestState struct {
	requested atomic.Uint64
	completed atomic.Uint64
}

func lockSyncRequest(state *syncRequestState) (unlock func(), ok bool) {
	request := state.requested.Add(1)
	lockSync()
	if state.completed.Load() >= request {
		unlockSync()
		return nil, false
	}

	runRequests := state.requested.Load()
	unlock = func() {
		state.completed.Store(runRequests)
		unlockSync()
	}
	return unlock, true
}

func syncData(exit, byHand bool) {
	defer logging.Recover()

	if !checkSync(false, exit, byHand) {
		return
	}

	requests := &syncAutoRequests
	if byHand {
		requests = &syncManualRequests
	} else if exit {
		requests = &syncExitRequests
	}
	unlock, ok := lockSyncRequest(requests)
	if !ok {
		return
	}
	defer unlock()
	_ = syncDataLocked(exit, byHand)
}

func syncDataLocked(exit, byHand bool) error {
	util.BroadcastByType("main", "syncing", 0, Conf.Language(81), nil)
	if exit {
		ExitSyncSucc = 0
		logging.LogInfof("sync before exit")
		msgId := util.PushMsg(Conf.Language(81), 1000*60*15)
		defer func() {
			util.PushClearMsg(msgId)
		}()
	}

	now := util.CurrentTimeMillis()
	Conf.Sync.Synced = now

	dataChanged, err := syncRepoWithDNSRetry(exit, byHand)
	code := 1
	if err != nil {
		code = 2
	}
	util.BroadcastByType("main", "syncing", code, Conf.Sync.Stat, nil)

	if !exit && 1 == code {
		consumeShorthands()
	}

	if nil == webSocketConn && Conf.Sync.Perception {
		// 如果 websocket 连接已经断开，则重新连接
		connectSyncWebSocket()
	}

	if 1 == Conf.Sync.Mode && nil != webSocketConn && Conf.Sync.Perception && dataChanged {
		// 如果处于自动同步模式且不是由 WS 触发的同步，则通知其他设备上的内核进行同步
		request := map[string]any{
			"cmd":    "synced",
			"synced": Conf.Sync.Synced,
		}
		if writeErr := webSocketConn.WriteJSON(request); nil != writeErr {
			logging.LogErrorf("write websocket message failed: %v", writeErr)
		}
	}
	return err
}

func checkSync(boot, exit, byHand bool) bool {
	if 2 == Conf.Sync.Mode && !boot && !exit && !byHand { // 手动模式下只有启动和退出进行同步
		return false
	}

	if 3 == Conf.Sync.Mode && !byHand { // 完全手动模式下只有手动进行同步
		return false
	}

	if !Conf.Sync.Enabled {
		if byHand {
			util.PushMsg(Conf.Language(124), 5000)
		}
		return false
	}

	if !cloud.IsValidCloudDirName(Conf.Sync.CloudName) {
		if byHand {
			util.PushMsg(Conf.Language(123), 5000)
		}
		return false
	}

	switch Conf.Sync.Provider {
	case conf.ProviderSiYuan:
		if !IsSubscriber() {
			Conf.Sync.Enabled = false
			Conf.Save()
			return false
		}
	case conf.ProviderWebDAV, conf.ProviderS3, conf.ProviderLocal:
		if !IsPaidUser() {
			Conf.Sync.Enabled = false
			Conf.Save()
			return false
		}
	}

	if 7 < autoSyncErrCount && !byHand {
		logging.LogErrorf("failed to auto-sync too many times, delay auto-sync 64 minutes")
		util.PushErrMsg(Conf.Language(125), 1000*60*60)
		planSyncAfter(64 * time.Minute)
		return false
	}
	return true
}

// incReindex 增量重建索引。
func incReindex(upserts, removes []string) (upsertRootIDs, removeRootIDs []string) {
	upsertRootIDs = []string{}
	removeRootIDs = []string{}

	util.IncBootProgress(3, Conf.Language(308))
	removeRootIDs = removeIndexes(removes) // 先执行 remove，否则移动文档时 upsert 会被忽略，导致未被索引
	upsertRootIDs = upsertIndexes(upserts)

	if 1 > len(removeRootIDs) {
		removeRootIDs = []string{}
	}
	if 1 > len(upsertRootIDs) {
		upsertRootIDs = []string{}
	}
	return
}

func removeIndexes(removeFilePaths []string) (removeRootIDs []string) {
	bootProgressPart := int32(10 / float64(len(removeFilePaths)))
	for _, removeFile := range removeFilePaths {
		if !strings.HasSuffix(removeFile, ".sy") {
			continue
		}

		rootID := util.GetTreeID(removeFile)
		removeRootIDs = append(removeRootIDs, rootID)

		msg := fmt.Sprintf(Conf.Language(39), rootID)
		util.IncBootProgress(bootProgressPart, msg)
		pushSyncStatusBar(msg)

		cache.RemoveTreeData(rootID)
		block := treenode.GetBlockTree(rootID)
		boxID := ""
		if nil != block {
			boxID = block.BoxID
			cache.RemoveDocIAL(block.Path)
		}
		sql.RemoveTreeQueue(boxID, rootID)
		bts := treenode.GetBlockTreesByRootIDInBox(rootID, boxID)
		for _, b := range bts {
			cache.RemoveBlockIAL(b.ID)
		}
		treenode.RemoveBlockTreesByRootID(boxID, rootID)
	}

	if 1 > len(removeRootIDs) {
		removeRootIDs = []string{}
	}
	return
}

func upsertIndexes(upsertFilePaths []string) (upsertRootIDs []string) {
	luteEngine := util.NewLute()
	bootProgressPart := int32(10 / float64(len(upsertFilePaths)))
	for _, upsertFile := range upsertFilePaths {
		rootID, indexed := func() (string, bool) {
			if !strings.HasSuffix(upsertFile, ".sy") {
				return "", false
			}

			upsertFile = filepath.ToSlash(upsertFile)
			upsertFile = strings.TrimPrefix(upsertFile, "/")

			box, _, found := strings.Cut(upsertFile, "/")
			if !found {
				// .sy 直接出现在 data 文件夹下，没有出现在笔记本文件夹下的情况
				return "", false
			}
			if IsEncryptedBox(box) {
				if !isBoxUnlockedForAccess(box) || !isEncryptedBoxMounted(box) {
					return "", false
				}
				if acquireErr := AcquireEncryptedBoxOperation(box); acquireErr != nil {
					return "", false
				}
				defer ReleaseEncryptedBoxOperation(box)
			}

			p := strings.TrimPrefix(upsertFile, box)
			msg := fmt.Sprintf(Conf.Language(40), util.GetTreeID(p))
			util.IncBootProgress(bootProgressPart, msg)
			pushSyncStatusBar(msg)

			rootID := util.GetTreeID(p)
			cache.RemoveTreeData(rootID)
			tree, err0 := filesys.LoadTree(box, p, luteEngine)
			if nil != err0 {
				return "", false
			}
			treenode.UpsertBlockTree(tree)
			sql.UpsertTreeQueue(tree)

			bts := treenode.GetBlockTreesByRootIDInBox(rootID, tree.Box)
			for _, b := range bts {
				cache.RemoveBlockIAL(b.ID)
			}
			cache.RemoveDocIAL(tree.Path)
			return rootID, true
		}()
		if indexed {
			upsertRootIDs = append(upsertRootIDs, rootID)
		}
	}

	if 1 > len(upsertRootIDs) {
		upsertRootIDs = []string{}
	}
	return
}

func SetCloudSyncDir(name string) {
	if !cloud.IsValidCloudDirName(name) {
		util.PushErrMsg(Conf.Language(37), 5000)
		return
	}

	if Conf.Sync.CloudName == name {
		return
	}

	Conf.Sync.CloudName = name
	Conf.Save()
	refreshLANSyncManager()
}

func SetSyncGenerateConflictDoc(b bool) {
	Conf.Sync.GenerateConflictDoc = b
	Conf.Save()
}

func SetSyncEnable(b bool) {
	Conf.Sync.Enabled = b
	Conf.Save()
	refreshLANSyncManager()
}

func SetSyncInterval(interval int) {
	if 30 > interval {
		interval = 30
	}
	if 43200 < interval {
		interval = 43200
	}

	Conf.Sync.Interval = interval
	Conf.Save()
	planSyncAfter(time.Duration(interval) * time.Second)
}

func SetSyncPerception(enabled bool) {
	if util.ContainerDocker == util.Container {
		enabled = false
	}

	Conf.Sync.Perception = enabled
	Conf.Save()

	if enabled {
		connectSyncWebSocket()
		return
	}

	closeSyncWebSocket()
}

func SetSyncMode(mode int) {
	Conf.Sync.Mode = mode
	Conf.Save()
}

func SetSyncProvider(provider int) (err error) {
	Conf.Sync.Provider = provider
	Conf.Save()
	refreshLANSyncManager()
	return
}

func SetSyncProviderS3(s3 *conf.S3) (err error) {
	s3.Endpoint = strings.TrimSpace(s3.Endpoint)
	s3.Endpoint = util.NormalizeEndpoint(s3.Endpoint)
	s3.AccessKey = strings.TrimSpace(s3.AccessKey)
	s3.SecretKey = strings.TrimSpace(s3.SecretKey)
	s3.Bucket = strings.TrimSpace(s3.Bucket)
	s3.Region = strings.TrimSpace(s3.Region)
	s3.Timeout = util.NormalizeTimeout(s3.Timeout)
	s3.ConcurrentReqs = util.NormalizeConcurrentReqs(s3.ConcurrentReqs, conf.ProviderS3)

	Conf.Sync.S3 = s3
	Conf.Save()
	refreshLANSyncManager()
	return
}

func SetSyncProviderWebDAV(webdav *conf.WebDAV) (err error) {
	webdav.Endpoint = strings.TrimSpace(webdav.Endpoint)
	webdav.Endpoint = util.NormalizeEndpoint(webdav.Endpoint)

	// 不支持配置坚果云 WebDAV 进行同步 https://github.com/siyuan-note/siyuan/issues/7657
	if strings.Contains(strings.ToLower(webdav.Endpoint), "dav.jianguoyun.com") {
		err = errors.New(Conf.Language(194))
		return
	}

	webdav.Username = strings.TrimSpace(webdav.Username)
	webdav.Password = strings.TrimSpace(webdav.Password)
	webdav.Timeout = util.NormalizeTimeout(webdav.Timeout)
	webdav.ConcurrentReqs = util.NormalizeConcurrentReqs(webdav.ConcurrentReqs, conf.ProviderWebDAV)

	Conf.Sync.WebDAV = webdav
	Conf.Save()
	refreshLANSyncManager()
	return
}

func SetSyncProviderLocal(local *conf.Local) (err error) {
	local.Endpoint = strings.TrimSpace(local.Endpoint)
	local.Endpoint = util.NormalizeLocalPath(local.Endpoint)

	absPath, err := filepath.Abs(local.Endpoint)
	if nil != err {
		msg := fmt.Sprintf("get endpoint [%s] abs path failed: %s", local.Endpoint, err)
		logging.LogError(msg)
		err = fmt.Errorf(Conf.Language(77), msg)
		return
	}
	if !gulu.File.IsExist(absPath) {
		msg := fmt.Sprintf("endpoint [%s] not exist", local.Endpoint)
		logging.LogError(msg)
		err = fmt.Errorf(Conf.Language(77), msg)
		return
	}
	if util.IsAbsPathInWorkspace(absPath) || filepath.Clean(absPath) == filepath.Clean(util.WorkspaceDir) {
		msg := fmt.Sprintf("endpoint [%s] is in workspace", local.Endpoint)
		logging.LogError(msg)
		err = fmt.Errorf(Conf.Language(77), msg)
		return
	}

	if gulu.File.IsSubPath(absPath, util.WorkspaceDir) {
		msg := fmt.Sprintf("endpoint [%s] is parent of workspace", local.Endpoint)
		logging.LogError(msg)
		err = fmt.Errorf(Conf.Language(77), msg)
		return
	}

	local.Timeout = util.NormalizeTimeout(local.Timeout)
	local.ConcurrentReqs = util.NormalizeConcurrentReqs(local.ConcurrentReqs, conf.ProviderLocal)

	Conf.Sync.Local = local
	Conf.Save()
	refreshLANSyncManager()
	return
}

var (
	syncLock             = sync.Mutex{}
	isSyncing            = atomic.Bool{}
	syncAutoRequests     = syncRequestState{}
	syncManualRequests   = syncRequestState{}
	syncExitRequests     = syncRequestState{}
	syncUploadRequests   = syncRequestState{}
	syncDownloadRequests = syncRequestState{}
)

func CreateCloudSyncDir(name string) (err error) {
	switch Conf.Sync.Provider {
	case conf.ProviderSiYuan, conf.ProviderLocal:
		break
	default:
		err = errors.New(Conf.Language(131))
		return
	}

	name = util.RemoveInvalid(name)
	if !cloud.IsValidCloudDirName(name) {
		return errors.New(Conf.Language(37))
	}

	repo, err := newRepository()
	if err != nil {
		return
	}

	err = repo.CreateCloudRepo(name)
	if err != nil {
		err = errors.New(formatRepoErrorMsg(err))
		return
	}
	return
}

func RemoveCloudSyncDir(name string) (err error) {
	switch Conf.Sync.Provider {
	case conf.ProviderSiYuan, conf.ProviderLocal:
		break
	default:
		err = errors.New(Conf.Language(131))
		return
	}

	msgId := util.PushMsg(Conf.Language(116), 15000)

	repo, err := newRepository()
	if err != nil {
		return
	}

	err = repo.RemoveCloudRepo(name)
	if err != nil {
		err = errors.New(formatRepoErrorMsg(err))
		return
	}

	util.PushClearMsg(msgId)
	time.Sleep(500 * time.Millisecond)
	if Conf.Sync.CloudName == name {
		Conf.Sync.CloudName = "main"
		Conf.Save()
		util.PushMsg(Conf.Language(155), 5000)
	}
	return
}

func ListCloudSyncDir() (syncDirs []*Sync, hSize string, err error) {
	syncDirs = []*Sync{}
	var dirs []*cloud.Repo
	var size int64

	repo, err := newRepository()
	if err != nil {
		return
	}

	dirs, size, err = repo.GetCloudRepos()
	if err != nil {
		err = errors.New(formatRepoErrorMsg(err))
		return
	}
	if 1 > len(dirs) {
		dirs = append(dirs, &cloud.Repo{
			Name:    "main",
			Size:    0,
			Updated: time.Now().Format("2006-01-02 15:04:05"),
		})
	}

	for _, d := range dirs {
		dirSize := d.Size
		sync := &Sync{
			Size:      dirSize,
			HSize:     "-",
			Updated:   d.Updated,
			CloudName: d.Name,
		}
		if conf.ProviderSiYuan == Conf.Sync.Provider {
			sync.HSize = humanize.BytesCustomCeil(uint64(dirSize), 2)
		}
		syncDirs = append(syncDirs, sync)
	}
	hSize = "-"
	if conf.ProviderSiYuan == Conf.Sync.Provider {
		hSize = humanize.BytesCustomCeil(uint64(size), 2)
	}
	if conf.ProviderS3 == Conf.Sync.Provider {
		Conf.Sync.CloudName = syncDirs[0].CloudName
		Conf.Save()
	}
	return
}

func formatRepoErrorMsg(err error) string {
	msg := html.EscapeString(err.Error())
	if errors.Is(err, cloud.ErrCloudAuthFailed) {
		msg = Conf.Language(31)
	} else if errors.Is(err, cloud.ErrCloudObjectNotFound) {
		msg = Conf.Language(129)
	} else if errors.Is(err, dejavu.ErrLockCloudFailed) {
		msg = Conf.Language(188)
	} else if errors.Is(err, dejavu.ErrCloudLocked) {
		msg = Conf.Language(189)
	} else if errors.Is(err, dejavu.ErrRepoFatal) {
		msg = Conf.Language(23)
	} else if errors.Is(err, cloud.ErrSystemTimeIncorrect) {
		msg = Conf.Language(195)
	} else if errors.Is(err, cloud.ErrDeprecatedVersion) {
		msg = Conf.Language(212)
	} else if errors.Is(err, cloud.ErrCloudCheckFailed) {
		msg = Conf.Language(213)
	} else if errors.Is(err, cloud.ErrCloudServiceUnavailable) {
		msg = Conf.language(219)
	} else if errors.Is(err, cloud.ErrCloudForbidden) {
		msg = Conf.language(249)
	} else if errors.Is(err, cloud.ErrCloudTooManyRequests) {
		msg = Conf.language(250)
	} else if errors.Is(err, cloud.ErrDecryptFailed) {
		msg = Conf.Language(135)
	} else {
		logging.LogErrorf("sync failed caused by network: %s", msg)
		msgLowerCase := strings.ToLower(msg)
		if strings.Contains(msgLowerCase, "permission denied") || strings.Contains(msg, "access is denied") {
			msg = Conf.Language(33)
		} else if strings.Contains(msgLowerCase, "region was not a valid") {
			msg = Conf.language(254)
		} else if strings.Contains(msgLowerCase, "device or resource busy") || strings.Contains(msg, "is being used by another") {
			msg = fmt.Sprintf(Conf.Language(85), err)
		} else if strings.Contains(msgLowerCase, "cipher: message authentication failed") {
			msg = Conf.Language(135)
		} else if isDNSError(msgLowerCase) {
			msg = Conf.Language(24)
		} else if strings.Contains(msgLowerCase, "net/http: request canceled while waiting for connection") || strings.Contains(msgLowerCase, "exceeded while awaiting") || strings.Contains(msgLowerCase, "context deadline exceeded") || strings.Contains(msgLowerCase, "timeout") || strings.Contains(msgLowerCase, "context cancellation while reading body") {
			msg = Conf.Language(24)
		} else if strings.Contains(msgLowerCase, "connection") || strings.Contains(msgLowerCase, "refused") || strings.Contains(msgLowerCase, "socket") || strings.Contains(msgLowerCase, "eof") || strings.Contains(msgLowerCase, "closed") || strings.Contains(msgLowerCase, "network") {
			msg = Conf.Language(28)
		}
	}
	msg += " (Provider: " + conf.ProviderToStr(Conf.Sync.Provider) + ")"
	return msg
}

// isDNSError 判断错误信息是否属于 DNS 解析类（域名解析失败、主机名无法解析等）。
// dejavu/cloud 层用 fmt.Errorf 原样透传底层网络错误，因此这里用字符串匹配兜底。
func isDNSError(msg string) bool {
	return strings.Contains(msg, "no such host") ||
		strings.Contains(msg, "connection failed") ||
		strings.Contains(msg, "hostname resolution") ||
		strings.Contains(msg, "no address associated with hostname")
}

// lastDNSFlushTime 及其锁用于 DNS 刷新节流，避免自动同步循环里反复 fork 系统命令。
// 由于同步可能从多个入口并发执行（如启动后台同步与手动同步），这里用互斥锁保护。
var (
	lastDNSFlushTime   time.Time
	lastDNSFlushTimeMu sync.Mutex
)

// flushAndRetryOnDNSError 在确认是 DNS 类错误且距上次刷新超过 5 分钟时，刷新系统 DNS 缓存并返回 true
// 以触发上层重试一次同步；否则返回 false。节流是为了避免高频自动同步反复 fork 系统命令。
func flushAndRetryOnDNSError(err error) bool {
	if !isDNSError(strings.ToLower(err.Error())) {
		return false
	}

	lastDNSFlushTimeMu.Lock()
	defer lastDNSFlushTimeMu.Unlock()
	if time.Since(lastDNSFlushTime) < 5*time.Minute {
		logging.LogInfof("sync failed with DNS error, but DNS cache was flushed recently, skip retry")
		return false
	}
	lastDNSFlushTime = time.Now()

	logging.LogInfof("sync failed with DNS error [%s], flushing DNS cache and retrying once", err)
	flushDNS()
	return true
}

// syncRepoWithDNSRetry 执行一次同步，若失败且判定为 DNS 类错误，则刷新系统 DNS 缓存后重试一次。
// 统一封装 DNS 重试逻辑，供主同步流程（syncData）与启动后台同步复用。
func syncRepoWithDNSRetry(exit, byHand bool) (dataChanged bool, err error) {
	dataChanged, err = syncRepo(exit, byHand)
	if nil != err && flushAndRetryOnDNSError(err) {
		dataChanged, err = syncRepo(exit, byHand)
	}
	return
}

// syncRepoDownloadWithDNSRetry 仅下载同步，DNS 类错误时刷新系统 DNS 缓存后重试一次。
func syncRepoDownloadWithDNSRetry() (err error) {
	err = syncRepoDownload()
	if nil != err && flushAndRetryOnDNSError(err) {
		err = syncRepoDownload()
	}
	return
}

// syncRepoUploadWithDNSRetry 仅上传同步，DNS 类错误时刷新系统 DNS 缓存后重试一次。
func syncRepoUploadWithDNSRetry() (err error) {
	err = syncRepoUpload()
	if nil != err && flushAndRetryOnDNSError(err) {
		err = syncRepoUpload()
	}
	return
}

func bootSyncRepoWithDNSRetry() (err error) {
	err = bootSyncRepo()
	if nil != err && flushAndRetryOnDNSError(err) {
		err = bootSyncRepo()
	}
	return
}

func getSyncIgnoreLines() (ret []string) {
	ignore := filepath.Join(util.DataDir, ".siyuan", "syncignore")
	err := os.MkdirAll(filepath.Dir(ignore), 0755)
	if err != nil {
		return
	}
	if !gulu.File.IsExist(ignore) {
		if err = gulu.File.WriteFileSafer(ignore, nil, 0644); err != nil {
			logging.LogErrorf("create syncignore [%s] failed: %s", ignore, err)
			return
		}
	}
	data, err := os.ReadFile(ignore)
	if err != nil {
		logging.LogErrorf("read syncignore [%s] failed: %s", ignore, err)
		return
	}
	dataStr := string(data)
	dataStr = strings.ReplaceAll(dataStr, "\r\n", "\n")
	ret = strings.Split(dataStr, "\n")

	// 忽略用户指南
	ret = append(ret, "20210808180117-6v0mkxr/**/*")
	ret = append(ret, "20210808180117-czj9bvb/**/*")
	ret = append(ret, "20211226090932-5lcq56f/**/*")
	ret = append(ret, "20240530133126-axarxgx/**/*")
	// 视图状态仅在当前设备使用，不参与数据同步。
	ret = append(ret, "/storage/view-state.json")
	ret = append(ret, "/storage/view-state-corrupted-*.json")
	// 忽略用户指南的数据库 JSON 文件
	for _, avName := range getAllUserGuideAVJSONFiles() {
		ret = append(ret, "/storage/av/"+avName)
	}

	ret = gulu.Str.RemoveDuplicatedElem(ret)
	return
}

func IncSync() {
	syncSameCount.Store(0)
	planSyncAfter(time.Duration(Conf.Sync.Interval) * time.Second)
}

func planSyncAfter(d time.Duration) {
	syncPlanTimeLock.Lock()
	syncPlanTime = time.Now().Add(d)
	syncPlanTimeLock.Unlock()
}

var (
	webSocketConn     *websocket.Conn
	webSocketConnLock = sync.Mutex{}
)

type OnlineKernel struct {
	ID       string `json:"id"`
	Hostname string `json:"hostname"`
	OS       string `json:"os"`
	Ver      string `json:"ver"`
}

var (
	onlineKernels     []*OnlineKernel
	onlineKernelsLock = sync.Mutex{}
)

func GetOnlineKernels() (ret []*OnlineKernel) {
	ret = []*OnlineKernel{}
	onlineKernelsLock.Lock()
	tmp := onlineKernels
	onlineKernelsLock.Unlock()
	for _, kernel := range tmp {
		if kernel.ID == KernelID {
			continue
		}

		ret = append(ret, kernel)
	}
	return
}

var closedSyncWebSocket = atomic.Bool{}

func closeSyncWebSocket() {
	defer logging.Recover()

	webSocketConnLock.Lock()
	defer webSocketConnLock.Unlock()

	if nil != webSocketConn {
		webSocketConn.Close()
		webSocketConn = nil
		closedSyncWebSocket.Store(true)
	}

	logging.LogInfof("sync websocket closed")
}

func connectSyncWebSocket() {
	defer logging.Recover()

	if !Conf.Sync.Enabled || !IsSubscriber() || conf.ProviderSiYuan != Conf.Sync.Provider {
		return
	}

	if util.ContainerDocker == util.Container {
		return
	}

	webSocketConnLock.Lock()
	defer webSocketConnLock.Unlock()

	if nil != webSocketConn {
		return
	}

	//logging.LogInfof("connecting sync websocket...")
	var dialErr error
	webSocketConn, dialErr = dialSyncWebSocket()
	if nil != dialErr {
		logging.LogWarnf("connect sync websocket failed: %s", dialErr)
		return
	}
	logging.LogInfof("sync websocket connected")

	webSocketConn.SetCloseHandler(func(code int, text string) error {
		logging.LogWarnf("sync websocket closed: %d, %s", code, text)
		return nil
	})

	go func() {
		defer logging.Recover()

		for {
			result := gulu.Ret.NewResult()
			if readErr := webSocketConn.ReadJSON(&result); nil != readErr {
				time.Sleep(1 * time.Second)
				if closedSyncWebSocket.Load() {
					return
				}

				reconnected := false
				for range 7 {
					time.Sleep(7 * time.Second)
					if nil == Conf.GetUser() {
						return
					}

					//logging.LogInfof("reconnecting sync websocket...")
					webSocketConn, dialErr = dialSyncWebSocket()
					if nil != dialErr {
						logging.LogWarnf("reconnect sync websocket failed: %s", dialErr)
						continue
					}

					logging.LogInfof("sync websocket reconnected")
					reconnected = true
					break
				}
				if !reconnected {
					logging.LogWarnf("reconnect sync websocket failed, do not retry")
					webSocketConn = nil
					return
				}

				continue
			}

			logging.LogInfof("sync websocket message: %v", result)
			data := result.Data.(map[string]any)
			switch data["cmd"].(string) {
			case "synced":
				// Improve data synchronization perception https://github.com/siyuan-note/siyuan/issues/13000
				SyncDataDownload()
			case "kernels":
				onlineKernelsLock.Lock()

				onlineKernels = []*OnlineKernel{}
				for _, kernel := range data["kernels"].([]any) {
					kernelMap := kernel.(map[string]any)
					onlineKernels = append(onlineKernels, &OnlineKernel{
						ID:       kernelMap["id"].(string),
						Hostname: kernelMap["hostname"].(string),
						OS:       kernelMap["os"].(string),
						Ver:      kernelMap["ver"].(string),
					})
				}

				onlineKernelsLock.Unlock()
			}
		}
	}()
}

var KernelID = gulu.Rand.String(7)

func dialSyncWebSocket() (c *websocket.Conn, err error) {
	endpoint := util.GetCloudWebSocketServer() + "/apis/siyuan/dejavu/ws"
	header := http.Header{
		"User-Agent":        []string{util.UserAgent},
		"x-siyuan-uid":      []string{Conf.GetUser().UserId},
		"x-siyuan-kernel":   []string{KernelID},
		"x-siyuan-ver":      []string{util.Ver},
		"x-siyuan-os":       []string{runtime.GOOS},
		"x-siyuan-hostname": []string{util.GetDeviceName()},
		"x-siyuan-repo":     []string{Conf.Sync.CloudName},
	}
	c, _, err = websocket.DefaultDialer.Dial(endpoint, header)
	if err == nil {
		closedSyncWebSocket.Store(false)
	}
	return
}
