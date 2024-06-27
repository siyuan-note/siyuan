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

package model

import (
	"errors"
	"fmt"
	"net/http"
	"os"
	"path"
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

	util.BroadcastByType("main", "syncing", 0, Conf.Language(81), nil)
	if !isProviderOnline(true) { // 这个操作比较耗时，所以要先推送 syncing 事件后再判断网络，这样才能给用户更即时的反馈
		util.BroadcastByType("main", "syncing", 2, Conf.Language(28), nil)
		return
	}

	lockSync()
	defer unlockSync()

	now := util.CurrentTimeMillis()
	Conf.Sync.Synced = now

	err := syncRepoDownload()
	code := 1
	if nil != err {
		code = 2
	}
	util.BroadcastByType("main", "syncing", code, Conf.Sync.Stat, nil)
}

func SyncDataUpload() {
	defer logging.Recover()

	if !checkSync(false, false, true) {
		return
	}

	util.BroadcastByType("main", "syncing", 0, Conf.Language(81), nil)
	if !isProviderOnline(true) { // 这个操作比较耗时，所以要先推送 syncing 事件后再判断网络，这样才能给用户更即时的反馈
		util.BroadcastByType("main", "syncing", 2, Conf.Language(28), nil)
		return
	}

	lockSync()
	defer unlockSync()

	now := util.CurrentTimeMillis()
	Conf.Sync.Synced = now

	err := syncRepoUpload()
	code := 1
	if nil != err {
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

	if Conf.Sync.Perception {
		connectSyncWebSocket()
	}

	if !checkSync(true, false, false) {
		return
	}

	if !isProviderOnline(false) {
		BootSyncSucc = 1
		util.PushErrMsg(Conf.Language(76), 7000)
		return
	}

	lockSync()
	defer unlockSync()

	util.IncBootProgress(3, "Syncing data from the cloud...")
	BootSyncSucc = 0
	logging.LogInfof("sync before boot")

	now := util.CurrentTimeMillis()
	Conf.Sync.Synced = now
	util.BroadcastByType("main", "syncing", 0, Conf.Language(81), nil)
	err := bootSyncRepo()
	code := 1
	if nil != err {
		code = 2
	}
	util.BroadcastByType("main", "syncing", code, Conf.Sync.Stat, nil)
	return
}

func SyncData(byHand bool) {
	syncData(false, byHand)
}

func lockSync() {
	syncLock.Lock()
	isSyncing.Store(true)
}

func unlockSync() {
	isSyncing.Store(false)
	syncLock.Unlock()
}

func syncData(exit, byHand bool) {
	defer logging.Recover()

	if !checkSync(false, exit, byHand) {
		return
	}

	lockSync()
	defer unlockSync()

	util.BroadcastByType("main", "syncing", 0, Conf.Language(81), nil)
	if !exit && !isProviderOnline(byHand) { // 这个操作比较耗时，所以要先推送 syncing 事件后再判断网络，这样才能给用户更即时的反馈
		util.BroadcastByType("main", "syncing", 2, Conf.Language(28), nil)
		return
	}

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

	dataChanged, err := syncRepo(exit, byHand)
	code := 1
	if nil != err {
		code = 2
	}
	util.BroadcastByType("main", "syncing", code, Conf.Sync.Stat, nil)

	if nil == webSocketConn && Conf.Sync.Perception {
		// 如果 websocket 连接已经断开，则重新连接
		connectSyncWebSocket()
	}

	if 1 == Conf.Sync.Mode && nil != webSocketConn && Conf.Sync.Perception && dataChanged {
		// 如果处于自动同步模式且不是又 WS 触发的同步，则通知其他设备上的内核进行同步
		request := map[string]interface{}{
			"cmd":    "synced",
			"synced": Conf.Sync.Synced,
		}
		if writeErr := webSocketConn.WriteJSON(request); nil != writeErr {
			logging.LogErrorf("write websocket message failed: %v", writeErr)
		}
	}
	return
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
			return false
		}
	case conf.ProviderWebDAV, conf.ProviderS3:
		if !IsPaidUser() {
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

	util.IncBootProgress(3, "Sync reindexing...")
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

		id := strings.TrimSuffix(filepath.Base(removeFile), ".sy")
		removeRootIDs = append(removeRootIDs, id)
		block := treenode.GetBlockTree(id)
		if nil != block {
			msg := fmt.Sprintf(Conf.Language(39), block.RootID)
			util.IncBootProgress(bootProgressPart, msg)
			util.PushStatusBar(msg)

			bts := treenode.GetBlockTreesByRootID(block.RootID)
			for _, b := range bts {
				cache.RemoveBlockIAL(b.ID)
			}
			cache.RemoveDocIAL(block.Path)

			treenode.RemoveBlockTreesByRootID(block.RootID)
			sql.RemoveTreeQueue(block.RootID)
		}
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
		msg := fmt.Sprintf(Conf.Language(40), strings.TrimSuffix(path.Base(p), ".sy"))
		util.IncBootProgress(bootProgressPart, msg)
		util.PushStatusBar(msg)

		tree, err0 := filesys.LoadTree(box, p, luteEngine)
		if nil != err0 {
			continue
		}
		treenode.UpsertBlockTree(tree)
		sql.UpsertTreeQueue(tree)

		bts := treenode.GetBlockTreesByRootID(tree.ID)
		for _, b := range bts {
			cache.RemoveBlockIAL(b.ID)
		}
		cache.RemoveDocIAL(tree.Path)

		upsertRootIDs = append(upsertRootIDs, tree.Root.ID)
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
}

func SetSyncGenerateConflictDoc(b bool) {
	Conf.Sync.GenerateConflictDoc = b
	Conf.Save()
	return
}

func SetSyncEnable(b bool) {
	Conf.Sync.Enabled = b
	Conf.Save()
	return
}

func SetSyncPerception(b bool) {
	if util.ContainerDocker == util.Container {
		b = false
	}

	Conf.Sync.Perception = b
	Conf.Save()

	if b {
		connectSyncWebSocket()
	} else {
		closeSyncWebSocket()
	}
	return
}

func SetSyncMode(mode int) {
	Conf.Sync.Mode = mode
	Conf.Save()
	return
}

func SetSyncProvider(provider int) (err error) {
	Conf.Sync.Provider = provider
	Conf.Save()
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

	if !cloud.IsValidCloudDirName(s3.Bucket) {
		util.PushErrMsg(Conf.Language(37), 5000)
		return
	}

	Conf.Sync.S3 = s3
	Conf.Save()
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

	Conf.Sync.WebDAV = webdav
	Conf.Save()
	return
}

var (
	syncLock  = sync.Mutex{}
	isSyncing = atomic.Bool{}
)

func CreateCloudSyncDir(name string) (err error) {
	if conf.ProviderSiYuan != Conf.Sync.Provider {
		err = errors.New(Conf.Language(131))
		return
	}

	name = strings.TrimSpace(name)
	name = gulu.Str.RemoveInvisible(name)
	if !cloud.IsValidCloudDirName(name) {
		return errors.New(Conf.Language(37))
	}

	repo, err := newRepository()
	if nil != err {
		return
	}

	err = repo.CreateCloudRepo(name)
	if nil != err {
		err = errors.New(formatRepoErrorMsg(err))
		return
	}
	return
}

func RemoveCloudSyncDir(name string) (err error) {
	if conf.ProviderSiYuan != Conf.Sync.Provider {
		err = errors.New(Conf.Language(131))
		return
	}

	msgId := util.PushMsg(Conf.Language(116), 15000)

	if "" == name {
		return
	}

	repo, err := newRepository()
	if nil != err {
		return
	}

	err = repo.RemoveCloudRepo(name)
	if nil != err {
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
	if nil != err {
		return
	}

	dirs, size, err = repo.GetCloudRepos()
	if nil != err {
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
	} else {
		msgLowerCase := strings.ToLower(msg)
		if strings.Contains(msgLowerCase, "permission denied") || strings.Contains(msg, "access is denied") {
			msg = Conf.Language(33)
		} else if strings.Contains(msgLowerCase, "device or resource busy") || strings.Contains(msg, "is being used by another") {
			msg = fmt.Sprintf(Conf.Language(85), err)
		} else if strings.Contains(msgLowerCase, "cipher: message authentication failed") {
			msg = Conf.Language(135)
		} else if strings.Contains(msgLowerCase, "no such host") || strings.Contains(msgLowerCase, "connection failed") || strings.Contains(msgLowerCase, "hostname resolution") || strings.Contains(msgLowerCase, "No address associated with hostname") {
			msg = Conf.Language(24)
		} else if strings.Contains(msgLowerCase, "net/http: request canceled while waiting for connection") || strings.Contains(msgLowerCase, "exceeded while awaiting") || strings.Contains(msgLowerCase, "context deadline exceeded") || strings.Contains(msgLowerCase, "timeout") || strings.Contains(msgLowerCase, "context cancellation while reading body") {
			msg = Conf.Language(24)
		} else if strings.Contains(msgLowerCase, "connection was") || strings.Contains(msgLowerCase, "reset by peer") || strings.Contains(msgLowerCase, "refused") || strings.Contains(msgLowerCase, "socket") || strings.Contains(msgLowerCase, "closed idle connection") || strings.Contains(msgLowerCase, "eof") {
			msg = Conf.Language(28)
		}
	}
	msg += " (Provider: " + conf.ProviderToStr(Conf.Sync.Provider) + ")"
	return msg
}

func getSyncIgnoreLines() (ret []string) {
	ignore := filepath.Join(util.DataDir, ".siyuan", "syncignore")
	err := os.MkdirAll(filepath.Dir(ignore), 0755)
	if nil != err {
		return
	}
	if !gulu.File.IsExist(ignore) {
		if err = gulu.File.WriteFileSafer(ignore, nil, 0644); nil != err {
			logging.LogErrorf("create syncignore [%s] failed: %s", ignore, err)
			return
		}
	}
	data, err := os.ReadFile(ignore)
	if nil != err {
		logging.LogErrorf("read syncignore [%s] failed: %s", ignore, err)
		return
	}
	dataStr := string(data)
	dataStr = strings.ReplaceAll(dataStr, "\r\n", "\n")
	ret = strings.Split(dataStr, "\n")

	// 默认忽略帮助文档
	ret = append(ret, "20210808180117-6v0mkxr/**/*")
	ret = append(ret, "20210808180117-czj9bvb/**/*")
	ret = append(ret, "20211226090932-5lcq56f/**/*")
	ret = append(ret, "20240530133126-axarxgx/**/*")

	ret = gulu.Str.RemoveDuplicatedElem(ret)
	return
}

func IncSync() {
	syncSameCount.Store(0)
	planSyncAfter(30 * time.Second)
}

func planSyncAfter(d time.Duration) {
	syncPlanTimeLock.Lock()
	syncPlanTime = time.Now().Add(d)
	syncPlanTimeLock.Unlock()
}

func isProviderOnline(byHand bool) (ret bool) {
	checkURL := util.GetCloudSyncServer()
	skipTlsVerify := false
	switch Conf.Sync.Provider {
	case conf.ProviderSiYuan:
	case conf.ProviderS3:
		checkURL = Conf.Sync.S3.Endpoint
		skipTlsVerify = Conf.Sync.S3.SkipTlsVerify
	case conf.ProviderWebDAV:
		checkURL = Conf.Sync.WebDAV.Endpoint
		skipTlsVerify = Conf.Sync.WebDAV.SkipTlsVerify
	default:
		logging.LogWarnf("unknown provider: %d", Conf.Sync.Provider)
		return false
	}

	if ret = util.IsOnline(checkURL, skipTlsVerify); !ret {
		if 1 > autoSyncErrCount || byHand {
			util.PushErrMsg(Conf.Language(76)+" (Provider: "+conf.ProviderToStr(Conf.Sync.Provider)+")", 5000)
		}
		if !byHand {
			planSyncAfter(fixSyncInterval)
			autoSyncErrCount++
		}
	}
	return
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
				for retries := 0; retries < 7; retries++ {
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
			data := result.Data.(map[string]interface{})
			switch data["cmd"].(string) {
			case "synced":
				syncData(false, false)
			case "kernels":
				onlineKernelsLock.Lock()

				onlineKernels = []*OnlineKernel{}
				for _, kernel := range data["kernels"].([]interface{}) {
					kernelMap := kernel.(map[string]interface{})
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
	if nil == err {
		closedSyncWebSocket.Store(false)
	}
	return
}
