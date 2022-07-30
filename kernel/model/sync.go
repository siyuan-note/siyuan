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
	"os/exec"
	"path"
	"path/filepath"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/88250/gulu"
	"github.com/dustin/go-humanize"
	"github.com/siyuan-note/dejavu"
	"github.com/siyuan-note/logging"
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
	defer logging.Recover()

	if !boot && !exit && 2 == Conf.Sync.Mode && !byHand {
		return
	}

	if util.IsMutexLocked(&syncLock) {
		logging.LogWarnf("sync is in progress")
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
	if !IsSubscriber() || !Conf.Sync.Enabled || "" == Conf.Sync.CloudName {
		if byHand {
			if "" == Conf.Sync.CloudName {
				util.PushMsg(Conf.Language(123), 5000)
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
		logging.LogInfof("sync before boot")
	}
	if exit {
		logging.LogInfof("sync before exit")
		util.PushMsg(Conf.Language(81), 1000*60*15)
	}

	if 7 < syncDownloadErrCount && !byHand {
		logging.LogErrorf("sync download error too many times, cancel auto sync, try to sync by hand")
		util.PushErrMsg(Conf.Language(125), 1000*60*60)
		planSyncAfter(64 * time.Minute)
		return
	}

	now := util.CurrentTimeMillis()
	Conf.Sync.Synced = now

	util.BroadcastByType("main", "syncing", 0, Conf.Language(81), nil)
	err := syncRepo(boot, exit, byHand)
	synced := util.Millisecond2Time(Conf.Sync.Synced).Format("2006-01-02 15:04:05") + "\n\n"
	if nil == err {
		synced += Conf.Sync.Stat
	} else {
		synced += fmt.Sprintf(Conf.Language(80), err)
	}
	msg := fmt.Sprintf(Conf.Language(82), synced)
	Conf.Sync.Stat = msg
	Conf.Save()
	util.BroadcastByType("main", "syncing", 1, msg, nil)
	return
}

// incReindex 增量重建索引。
func incReindex(upserts, removes []string) {
	util.IncBootProgress(3, "Sync reindexing...")
	needPushRemoveProgress := 32 < len(removes)
	needPushUpsertProgress := 32 < len(upserts)
	msg := fmt.Sprintf(Conf.Language(35))
	util.PushStatusBar(msg)
	if needPushRemoveProgress || needPushUpsertProgress {
		util.PushEndlessProgress(msg)
	}

	logging.LogDebugf("sync reindex [upserts=%d, removes=%d]", len(upserts), len(removes))

	// 先执行 remove，否则移动文档时 upsert 会被忽略，导致未被索引
	bootProgressPart := 10 / float64(len(removes))
	for _, removeFile := range removes {
		if !strings.HasSuffix(removeFile, ".sy") {
			continue
		}

		id := strings.TrimSuffix(filepath.Base(removeFile), ".sy")
		block := treenode.GetBlockTree(id)
		if nil != block {
			msg = fmt.Sprintf(Conf.Language(39), block.RootID)
			util.IncBootProgress(bootProgressPart, msg)
			util.PushStatusBar(msg)
			if needPushRemoveProgress {
				util.PushEndlessProgress(msg)
			}

			treenode.RemoveBlockTreesByRootID(block.RootID)
			sql.RemoveTreeQueue(block.BoxID, block.RootID)
		}
	}

	msg = fmt.Sprintf(Conf.Language(35))
	util.PushStatusBar(msg)
	if needPushRemoveProgress || needPushUpsertProgress {
		util.PushEndlessProgress(msg)
	}

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
		if needPushUpsertProgress {
			util.PushEndlessProgress(msg)
		}

		tree, err0 := LoadTree(box, p)
		if nil != err0 {
			continue
		}
		treenode.ReindexBlockTree(tree)
		sql.UpsertTreeQueue(tree)
	}

	util.PushStatusBar(Conf.Language(58))
	if needPushRemoveProgress || needPushUpsertProgress {
		util.PushEndlessProgress(Conf.Language(58))
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

func SetSyncMode(mode int) (err error) {
	syncLock.Lock()
	defer syncLock.Unlock()

	Conf.Sync.Mode = mode
	Conf.Save()
	return
}

var syncLock = sync.Mutex{}

func CreateCloudSyncDir(name string) (err error) {
	syncLock.Lock()
	defer syncLock.Unlock()

	name = strings.TrimSpace(name)
	name = gulu.Str.RemoveInvisible(name)
	if !IsValidCloudDirName(name) {
		return errors.New(Conf.Language(37))
	}

	var cloudInfo *dejavu.CloudInfo
	cloudInfo, err = buildCloudInfo()
	if nil != err {
		return
	}

	err = dejavu.CreateCloudRepo(name, cloudInfo)
	return
}

func RemoveCloudSyncDir(name string) (err error) {
	msgId := util.PushMsg(Conf.Language(116), 15000)

	syncLock.Lock()
	defer syncLock.Unlock()

	if "" == name {
		return
	}

	var cloudInfo *dejavu.CloudInfo
	cloudInfo, err = buildCloudInfo()
	if nil != err {
		return
	}

	err = dejavu.RemoveCloudRepo(name, cloudInfo)
	if nil != err {
		err = errors.New(formatErrorMsg(err))
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
	var dirs []map[string]interface{}
	var size int64

	var cloudInfo *dejavu.CloudInfo
	cloudInfo, err = buildCloudInfo()
	if nil != err {
		return
	}

	dirs, size, err = dejavu.GetCloudRepos(cloudInfo)
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

func formatErrorMsg(err error) string {
	if errors.Is(err, dejavu.ErrCloudAuthFailed) {
		return Conf.Language(31) + " v" + util.Ver
	}

	msg := err.Error()
	msgLowerCase := strings.ToLower(msg)
	if strings.Contains(msgLowerCase, "permission denied") || strings.Contains(msg, "access is denied") {
		msg = Conf.Language(33) + " " + err.Error()
	} else if strings.Contains(msgLowerCase, "device or resource busy") || strings.Contains(msg, "is being used by another") {
		msg = fmt.Sprintf(Conf.Language(85), err)
	} else if strings.Contains(msgLowerCase, "cipher: message authentication failed") {
		msg = Conf.Language(135)
	} else if strings.Contains(msgLowerCase, "repo fatal error") {
		msg = Conf.Language(23) + " " + err.Error()
	} else if strings.Contains(msgLowerCase, "no such host") || strings.Contains(msgLowerCase, "connection failed") || strings.Contains(msgLowerCase, "hostname resolution") {
		msg = Conf.Language(24)
	} else if strings.Contains(msgLowerCase, "net/http: request canceled while waiting for connection") || strings.Contains(msgLowerCase, "exceeded while awaiting") || strings.Contains(msgLowerCase, "context deadline exceeded") {
		msg = Conf.Language(24)
	} else if strings.Contains(msgLowerCase, "cloud object not found") {
		msg = Conf.Language(129)
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
		logging.LogErrorf("robocopy data from [%s] to [%s] failed: %s %s", src, dest, string(output), err)
	}
	return gulu.File.Copy(src, dest)
}

func planSyncAfter(d time.Duration) {
	syncPlanTime = time.Now().Add(d)
}
