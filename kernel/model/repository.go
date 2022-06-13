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
	"encoding/hex"
	"errors"
	"os"

	"github.com/siyuan-note/dejavu"
	"github.com/siyuan-note/dejavu/entity"
	"github.com/siyuan-note/encryption"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func GetRepoFile(id string) (ret []byte, err error) {
	//repo, err := dejavu.NewRepo(util.DataDir, util.RepoDir, Conf.Repo.Key)
	//if nil != err {
	//	util.LogErrorf("init repo failed: %s", err)
	//	return
	//}

	return
}

func GetRepoIndexLogs(page int) (logs []*dejavu.Log, err error) {
	repo, err := dejavu.NewRepo(util.DataDir, util.RepoDir, Conf.Repo.Key)
	if nil != err {
		util.LogErrorf("init repo failed: %s", err)
		return
	}

	logs, err = repo.GetIndexLogs(page, 32)
	if nil != err {
		util.LogErrorf("get repo index logs failed: %s", err)
		return
	}
	return
}

func ImportRepoKey(hexKey string) (err error) {
	key, err := hex.DecodeString(hexKey)
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
	return
}

func InitRepoKey() (err error) {
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
		return
	}
	salt := string(randomBytes)

	key, err := encryption.KDF(password, salt)
	if nil != err {
		util.LogErrorf("init repo key failed: %s", err)
		return
	}
	Conf.Repo.Key = key
	Conf.Save()
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
		context.(func(msg string))(arg.(*entity.File).Path)
	},
}

func CheckoutRepo(id string) (err error) {
	if 1 > len(Conf.Repo.Key) {
		err = errors.New("repo key is nil")
		return
	}

	repo, err := dejavu.NewRepo(util.DataDir, util.RepoDir, Conf.Repo.Key)
	if nil != err {
		util.LogErrorf("init repo failed: %s", err)
		return
	}

	syncLock.Lock()
	defer syncLock.Unlock()
	filesys.ReleaseAllFileLocks()
	err = repo.Checkout(id, util.PushEndlessProgress, checkoutCallbacks)
	util.PushClearProgress()
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

func IndexRepo(message string) (err error) {
	if 1 > len(Conf.Repo.Key) {
		err = errors.New("repo key is nil")
		return
	}

	repo, err := dejavu.NewRepo(util.DataDir, util.RepoDir, Conf.Repo.Key)
	if nil != err {
		util.LogErrorf("init repo failed: %s", err)
		return
	}

	WaitForWritingFiles()
	syncLock.Lock()
	defer syncLock.Unlock()
	filesys.ReleaseAllFileLocks()
	_, err = repo.Index(message, util.PushEndlessProgress, indexCallbacks)
	util.PushClearProgress()
	return
}
