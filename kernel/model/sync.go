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
	"path/filepath"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/88250/gulu"
	"github.com/dustin/go-humanize"
	"github.com/siyuan-note/dejavu"
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

	syncRepo(boot, exit, byHand)
	return
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
	msg := err.Error()
	if strings.Contains(msg, "Permission denied") || strings.Contains(msg, "Access is denied") {
		msg = Conf.Language(33) + " " + err.Error()
	} else if strings.Contains(msg, "Device or resource busy") {
		msg = Conf.Language(85) + " " + err.Error()
	} else if strings.Contains(msg, "cipher: message authentication failed") {
		msg = Conf.Language(172) + " " + err.Error()
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
		util.LogErrorf("robocopy data from [%s] to [%s] failed: %s %s", src, dest, string(output), err)
	}
	return gulu.File.Copy(src, dest)
}

func planSyncAfter(d time.Duration) {
	syncPlanTime = time.Now().Add(d)
}
