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
	"os"
	"path"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/88250/gulu"
	"github.com/88250/lute/html"
	"github.com/dustin/go-humanize"
	"github.com/siyuan-note/dejavu"
	"github.com/siyuan-note/dejavu/cloud"
	"github.com/siyuan-note/logging"
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

	syncLock.Lock()
	defer syncLock.Unlock()

	now := util.CurrentTimeMillis()
	Conf.Sync.Synced = now

	err := syncRepoDownload()
	synced := util.Millisecond2Time(Conf.Sync.Synced).Format("2006-01-02 15:04:05") + "\n\n"
	if nil == err {
		synced += Conf.Sync.Stat
	} else {
		synced += fmt.Sprintf(Conf.Language(80), formatRepoErrorMsg(err))
	}
	msg := fmt.Sprintf(Conf.Language(82), synced)
	Conf.Sync.Stat = msg
	Conf.Save()
	code := 1
	if nil != err {
		code = 2
	}
	util.BroadcastByType("main", "syncing", code, msg, nil)
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

	syncLock.Lock()
	defer syncLock.Unlock()

	now := util.CurrentTimeMillis()
	Conf.Sync.Synced = now

	err := syncRepoUpload()
	synced := util.Millisecond2Time(Conf.Sync.Synced).Format("2006-01-02 15:04:05") + "\n\n"
	if nil == err {
		synced += Conf.Sync.Stat
	} else {
		synced += fmt.Sprintf(Conf.Language(80), formatRepoErrorMsg(err))
	}
	msg := fmt.Sprintf(Conf.Language(82), synced)
	Conf.Sync.Stat = msg
	Conf.Save()
	code := 1
	if nil != err {
		code = 2
	}
	util.BroadcastByType("main", "syncing", code, msg, nil)
	return
}

var (
	syncSameCount    = 0
	autoSyncErrCount = 0
	fixSyncInterval  = 5 * time.Minute
	syncPlanTime     = time.Now().Add(fixSyncInterval)

	BootSyncSucc = -1 // -1：未执行，0：执行成功，1：执行失败
	ExitSyncSucc = -1
)

func SyncDataJob() {
	if time.Now().Before(syncPlanTime) {
		return
	}

	SyncData(false)
}

func BootSyncData() {
	defer logging.Recover()

	if !checkSync(true, false, false) {
		return
	}

	if !isProviderOnline(false) {
		BootSyncSucc = 1
		util.PushErrMsg(Conf.Language(76), 7000)
		return
	}

	syncLock.Lock()
	defer syncLock.Unlock()

	util.IncBootProgress(3, "Syncing data from the cloud...")
	BootSyncSucc = 0
	logging.LogInfof("sync before boot")

	now := util.CurrentTimeMillis()
	Conf.Sync.Synced = now
	util.BroadcastByType("main", "syncing", 0, Conf.Language(81), nil)
	err := bootSyncRepo()
	synced := util.Millisecond2Time(Conf.Sync.Synced).Format("2006-01-02 15:04:05") + "\n\n"
	if nil == err {
		synced += Conf.Sync.Stat
	} else {
		synced += fmt.Sprintf(Conf.Language(80), formatRepoErrorMsg(err))
	}
	msg := fmt.Sprintf(Conf.Language(82), synced)
	Conf.Sync.Stat = msg
	Conf.Save()
	code := 1
	if nil != err {
		code = 2
	}
	util.BroadcastByType("main", "syncing", code, msg, nil)
	return
}

func SyncData(byHand bool) {
	syncData(false, byHand)
}

func syncData(exit, byHand bool) {
	defer logging.Recover()

	if !checkSync(false, exit, byHand) {
		return
	}

	util.BroadcastByType("main", "syncing", 0, Conf.Language(81), nil)
	if !exit && !isProviderOnline(byHand) { // 这个操作比较耗时，所以要先推送 syncing 事件后再判断网络，这样才能给用户更即时的反馈
		util.BroadcastByType("main", "syncing", 2, Conf.Language(28), nil)
		return
	}

	syncLock.Lock()
	defer syncLock.Unlock()

	if exit {
		ExitSyncSucc = 0
		logging.LogInfof("sync before exit")
		util.PushMsg(Conf.Language(81), 1000*60*15)
	}

	now := util.CurrentTimeMillis()
	Conf.Sync.Synced = now

	err := syncRepo(exit, byHand)
	synced := util.Millisecond2Time(Conf.Sync.Synced).Format("2006-01-02 15:04:05") + "\n\n"
	if nil == err {
		synced += Conf.Sync.Stat
	} else {
		synced += fmt.Sprintf(Conf.Language(80), formatRepoErrorMsg(err))
	}
	msg := fmt.Sprintf(Conf.Language(82), synced)
	Conf.Sync.Stat = msg
	Conf.Save()
	code := 1
	if nil != err {
		code = 2
	}
	util.BroadcastByType("main", "syncing", code, msg, nil)
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

	if !IsSubscriber() && conf.ProviderSiYuan == Conf.Sync.Provider {
		return false
	}

	if util.IsMutexLocked(&syncLock) {
		logging.LogWarnf("sync is in progress")
		planSyncAfter(fixSyncInterval)
		return false
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
	msg := fmt.Sprintf(Conf.Language(35))
	util.PushStatusBar(msg)

	luteEngine := util.NewLute()
	// 先执行 remove，否则移动文档时 upsert 会被忽略，导致未被索引
	bootProgressPart := 10 / float64(len(removes))
	for _, removeFile := range removes {
		if !strings.HasSuffix(removeFile, ".sy") {
			continue
		}

		id := strings.TrimSuffix(filepath.Base(removeFile), ".sy")
		removeRootIDs = append(removeRootIDs, id)
		block := treenode.GetBlockTree(id)
		if nil != block {
			msg = fmt.Sprintf(Conf.Language(39), block.RootID)
			util.IncBootProgress(bootProgressPart, msg)
			util.PushStatusBar(msg)

			treenode.RemoveBlockTreesByRootID(block.RootID)
			sql.RemoveTreeQueue(block.BoxID, block.RootID)
		}
	}

	msg = fmt.Sprintf(Conf.Language(35))
	util.PushStatusBar(msg)

	bootProgressPart = 10 / float64(len(upserts))
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
		msg = fmt.Sprintf(Conf.Language(40), strings.TrimSuffix(path.Base(p), ".sy"))
		util.IncBootProgress(bootProgressPart, msg)
		util.PushStatusBar(msg)

		tree, err0 := filesys.LoadTree(box, p, luteEngine)
		if nil != err0 {
			continue
		}
		treenode.IndexBlockTree(tree)
		sql.UpsertTreeQueue(tree)
		upsertRootIDs = append(upsertRootIDs, tree.Root.ID)
	}
	return
}

func SetCloudSyncDir(name string) {
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

func SetSyncMode(mode int) (err error) {
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

var syncLock = sync.Mutex{}

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
			sync.HSize = humanize.Bytes(uint64(dirSize))
		}
		syncDirs = append(syncDirs, sync)
	}
	hSize = "-"
	if conf.ProviderSiYuan == Conf.Sync.Provider {
		hSize = humanize.Bytes(uint64(size))
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
	} else if errors.Is(err, dejavu.ErrRepoFatalErr) {
		msg = Conf.Language(23)
	} else if errors.Is(err, cloud.ErrSystemTimeIncorrect) {
		msg = Conf.Language(195)
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

func getIgnoreLines() (ret []string) {
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

	ret = gulu.Str.RemoveDuplicatedElem(ret)
	return
}

func IncSync() {
	syncSameCount = 0
	planSyncAfter(30 * time.Second)
}

func planSyncAfter(d time.Duration) {
	syncPlanTime = time.Now().Add(d)
}

func isProviderOnline(byHand bool) (ret bool) {
	checkURL := util.SiYuanSyncServer
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
