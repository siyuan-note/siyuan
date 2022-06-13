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
	"errors"

	"github.com/siyuan-note/dejavu"
	"github.com/siyuan-note/encryption"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func InitRepoKey() (err error) {
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

var indexCallbacks = map[string]dejavu.Callback{
	"walkData": func(context, arg interface{}, err error) {
		context.(func(msg string))(arg.(string))
	},
	"getLatestFile": func(context, arg interface{}, err error) {
		context.(func(msg string))(arg.(string))
	},
	"upsertFile": func(context, arg interface{}, err error) {
		context.(func(msg string))(arg.(string))
	},
}

func IndexRepo(message string) (err error) {
	if 1 > len(Conf.Repo.Key) {
		err = errors.New("repo key is nil")
		return
	}

	repo, err := dejavu.NewRepo(util.DataDir, util.RepoDir, Conf.Repo.Key)
	if nil != err {
		return
	}

	_, err = repo.Index(message, util.PushEndlessProgress, indexCallbacks)
	util.PushClearProgress()
	return
}
