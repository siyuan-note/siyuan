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
	"encoding/base64"
	"errors"
	"fmt"
	"os"
	"time"

	"github.com/88250/gulu"
	"github.com/siyuan-note/dejavu"
	"github.com/siyuan-note/dejavu/entity"
	"github.com/siyuan-note/encryption"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func UploadSnapshot(id string) (err error) {
	if 1 > len(Conf.Repo.Key) {
		err = errors.New(Conf.Language(26))
		return
	}

	repo, err := dejavu.NewRepo(util.DataDir, util.RepoDir, Conf.Repo.Key)
	if nil != err {
		util.LogErrorf("init repo failed: %s", err)
		return
	}

	_ = repo
	return
}

func GetRepoIndexLogs(page int) (logs []*dejavu.Log, pageCount, totalCount int, err error) {
	if 1 > len(Conf.Repo.Key) {
		err = errors.New(Conf.Language(26))
		return
	}

	repo, err := dejavu.NewRepo(util.DataDir, util.RepoDir, Conf.Repo.Key)
	if nil != err {
		util.LogErrorf("init repo failed: %s", err)
		return
	}

	logs, pageCount, totalCount, err = repo.GetIndexLogs(page, 32)
	if nil != err {
		if dejavu.ErrNotFoundIndex == err {
			logs = []*dejavu.Log{}
			err = nil
			return
		}

		util.LogErrorf("get repo index logs failed: %s", err)
		return
	}
	return
}

func ImportRepoKey(base64Key string) (err error) {
	msgId := util.PushMsg(Conf.Language(136), 1000*7)

	key, err := base64.StdEncoding.DecodeString(base64Key)
	if nil != err {
		return
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
	util.PushUpdateMsg(msgId, Conf.Language(138), 3000)
	time.Sleep(1 * time.Second)
	if initErr := IndexRepo("Init data repo"); nil != initErr {
		util.PushUpdateMsg(msgId, fmt.Sprintf(Conf.Language(140), initErr), 7000)
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

func InitRepoKey() (err error) {
	msgId := util.PushMsg(Conf.Language(136), 1000*7)

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
		util.LogErrorf("init repo key failed: %s", err)
		util.PushUpdateMsg(msgId, Conf.Language(137), 5000)
		return
	}
	salt := string(randomBytes)

	key, err := encryption.KDF(password, salt)
	if nil != err {
		util.LogErrorf("init repo key failed: %s", err)
		util.PushUpdateMsg(msgId, Conf.Language(137), 5000)
		return
	}
	Conf.Repo.Key = key
	Conf.Save()

	time.Sleep(1 * time.Second)
	util.PushUpdateMsg(msgId, Conf.Language(138), 3000)
	time.Sleep(1 * time.Second)
	if initErr := IndexRepo("Init data repo"); nil != initErr {
		util.PushUpdateMsg(msgId, fmt.Sprintf(Conf.Language(140), initErr), 7000)
	}
	return
}

var checkoutCallbacks = map[string]dejavu.Callback{
	"walkData": func(context, arg interface{}, err error) {
		context.(func(msg string))(arg.(string))
	},
	"upsertFile": func(context, arg interface{}, err error) {
		context.(func(msg string))(arg.(*entity.File).Path)
	},
	"removeFile": func(context, arg interface{}, err error) {
		context.(func(msg string))(arg.(string))
	},
}

func CheckoutRepo(id string) (err error) {
	if 1 > len(Conf.Repo.Key) {
		err = errors.New(Conf.Language(26))
		return
	}

	repo, err := dejavu.NewRepo(util.DataDir, util.RepoDir, Conf.Repo.Key)
	if nil != err {
		util.LogErrorf("init repo failed: %s", err)
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

	err = repo.Checkout(id, util.PushEndlessProgress, checkoutCallbacks)
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

var indexCallbacks = map[string]dejavu.Callback{
	"walkData": func(context, arg interface{}, err error) {
		context.(func(msg string))(arg.(string))
	},
	"getLatestFile": func(context, arg interface{}, err error) {
		context.(func(msg string))(arg.(*entity.File).Path)
	},
	"upsertFile": func(context, arg interface{}, err error) {
		context.(func(msg string))(arg.(*entity.File).Path)
	},
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

	repo, err := dejavu.NewRepo(util.DataDir, util.RepoDir, Conf.Repo.Key)
	if nil != err {
		util.LogErrorf("init repo failed: %s", err)
		return
	}

	util.PushEndlessProgress(Conf.Language(143))
	writingDataLock.Lock()
	defer writingDataLock.Unlock()
	WaitForWritingFiles()
	sql.WaitForWritingDatabase()
	filelock.ReleaseAllFileLocks()
	_, err = repo.Index(memo, util.PushEndlessProgress, indexCallbacks)
	util.PushClearProgress()
	return
}

func indexRepoBeforeCloudSync() {
	if 1 > len(Conf.Repo.Key) {
		return
	}

	repo, err := dejavu.NewRepo(util.DataDir, util.RepoDir, Conf.Repo.Key)
	if nil != err {
		util.LogErrorf("init repo failed: %s", err)
		return
	}

	start := time.Now()
	latest, err := repo.Latest()
	index, err := repo.Index("[Auto] Cloud sync", nil, nil)
	if nil != err {
		util.LogErrorf("index repo before cloud sync failed: %s", err)
		return
	}
	elapsed := time.Since(start)
	if nil != latest && latest.ID != index.ID {
		// 对新创建的快照需要更新备注，加入耗时统计
		index.Memo = fmt.Sprintf("[Auto] Cloud sync, completed in [%.2fs]", elapsed.Seconds())
		err = repo.PutIndex(index)
		if nil != err {
			util.LogErrorf("put index into repo before cloud sync failed: %s", err)
			return
		}
	}
	if 7000 < elapsed.Milliseconds() {
		util.LogWarnf("index repo before cloud sync elapsed [%dms]", elapsed.Milliseconds())
	}
}
