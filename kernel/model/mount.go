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
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/88250/gulu"
	"github.com/88250/lute/ast"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func CreateBox(name string) (id string, err error) {
	name = gulu.Str.RemoveInvisible(name)
	if 512 < utf8.RuneCountInString(name) {
		// 限制笔记本名和文档名最大长度为 `512` https://github.com/siyuan-note/siyuan/issues/6299
		err = errors.New(Conf.Language(106))
		return
	}
	if "" == name {
		name = Conf.language(105)
	}

	WaitForWritingFiles()

	createDocLock.Lock()
	defer createDocLock.Unlock()

	id = ast.NewNodeID()
	boxLocalPath := filepath.Join(util.DataDir, id)
	err = os.MkdirAll(boxLocalPath, 0755)
	if nil != err {
		return
	}

	box := &Box{ID: id, Name: name}
	boxConf := box.GetConf()
	boxConf.Name = name
	box.SaveConf(boxConf)
	IncSync()
	logging.LogInfof("created box [%s]", id)
	return
}

func RenameBox(boxID, name string) (err error) {
	box := Conf.Box(boxID)
	if nil == box {
		return errors.New(Conf.Language(0))
	}

	if 512 < utf8.RuneCountInString(name) {
		// 限制笔记本名和文档名最大长度为 `512` https://github.com/siyuan-note/siyuan/issues/6299
		err = errors.New(Conf.Language(106))
		return
	}

	if "" == name {
		name = Conf.language(105)
	}

	boxConf := box.GetConf()
	boxConf.Name = name
	box.Name = name
	box.SaveConf(boxConf)
	IncSync()
	logging.LogInfof("renamed box [%s] to [%s]", boxID, name)
	return
}

var boxLock = sync.Map{}

func RemoveBox(boxID string) (err error) {
	if _, ok := boxLock.Load(boxID); ok {
		err = fmt.Errorf(Conf.language(239))
		return
	}

	boxLock.Store(boxID, true)
	defer boxLock.Delete(boxID)

	if util.IsReservedFilename(boxID) {
		return errors.New(fmt.Sprintf("can not remove [%s] caused by it is a reserved file", boxID))
	}

	WaitForWritingFiles()
	isUserGuide := IsUserGuide(boxID)
	createDocLock.Lock()
	defer createDocLock.Unlock()

	localPath := filepath.Join(util.DataDir, boxID)
	if !filelock.IsExist(localPath) {
		return
	}
	if !gulu.File.IsDir(localPath) {
		return errors.New(fmt.Sprintf("can not remove [%s] caused by it is not a dir", boxID))
	}

	if !isUserGuide {
		var historyDir string
		historyDir, err = GetHistoryDir(HistoryOpDelete)
		if nil != err {
			logging.LogErrorf("get history dir failed: %s", err)
			return
		}
		p := strings.TrimPrefix(localPath, util.DataDir)
		historyPath := filepath.Join(historyDir, p)
		if err = filelock.Copy(localPath, historyPath); nil != err {
			logging.LogErrorf("gen sync history failed: %s", err)
			return
		}

		copyBoxAssetsToDataAssets(boxID)
	}

	unmount0(boxID)
	if err = filelock.Remove(localPath); nil != err {
		return
	}
	IncSync()

	logging.LogInfof("removed box [%s]", boxID)
	return
}

func Unmount(boxID string) {
	WaitForWritingFiles()

	unmount0(boxID)
	evt := util.NewCmdResult("unmount", 0, util.PushModeBroadcast)
	evt.Data = map[string]interface{}{
		"box": boxID,
	}
	util.PushEvent(evt)
}

func unmount0(boxID string) {
	box := Conf.Box(boxID)
	if nil == box {
		return
	}

	boxConf := box.GetConf()
	boxConf.Closed = true
	box.SaveConf(boxConf)
	box.Unindex()
}

func Mount(boxID string) (alreadyMount bool, err error) {
	if _, ok := boxLock.Load(boxID); ok {
		err = fmt.Errorf(Conf.language(239))
		return
	}

	boxLock.Store(boxID, true)
	defer boxLock.Delete(boxID)

	WaitForWritingFiles()
	isUserGuide := IsUserGuide(boxID)

	localPath := filepath.Join(util.DataDir, boxID)
	var reMountGuide bool
	if isUserGuide {
		// 重新挂载帮助文档

		guideBox := Conf.Box(boxID)
		if nil != guideBox {
			unmount0(guideBox.ID)
			reMountGuide = true
		}

		if err = filelock.Remove(localPath); nil != err {
			return
		}

		p := filepath.Join(util.WorkingDir, "guide", boxID)
		if err = filelock.Copy(p, localPath); nil != err {
			return
		}

		avDirPath := filepath.Join(util.WorkingDir, "guide", boxID, "storage", "av")
		if filelock.IsExist(avDirPath) {
			if err = filelock.Copy(avDirPath, filepath.Join(util.DataDir, "storage", "av")); nil != err {
				return
			}
		}

		if box := Conf.Box(boxID); nil != box {
			boxConf := box.GetConf()
			boxConf.Closed = true
			box.SaveConf(boxConf)
		}

		if Conf.OpenHelp {
			Conf.OpenHelp = false
			Conf.Save()
		}

		go func() {
			time.Sleep(time.Second * 3)
			util.PushErrMsg(Conf.Language(52), 7000)

			// 每次打开帮助文档时自动检查版本更新并提醒 https://github.com/siyuan-note/siyuan/issues/5057
			time.Sleep(time.Second * 10)
			CheckUpdate(true)
		}()
	}

	if !gulu.File.IsDir(localPath) {
		return false, errors.New("can not open file, just support open folder only")
	}

	for _, box := range Conf.GetOpenedBoxes() {
		if box.ID == boxID {
			return true, nil
		}
	}

	box := &Box{ID: boxID}
	boxConf := box.GetConf()
	boxConf.Closed = false
	box.SaveConf(boxConf)

	box.Index()
	// 缓存根一级的文档树展开
	ListDocTree(box.ID, "/", util.SortModeUnassigned, false, false, Conf.FileTree.MaxListCount)
	util.ClearPushProgress(100)

	if reMountGuide {
		return true, nil
	}
	return false, nil
}

func IsUserGuide(boxID string) bool {
	return "20210808180117-czj9bvb" == boxID || "20210808180117-6v0mkxr" == boxID || "20211226090932-5lcq56f" == boxID || "20240530133126-axarxgx" == boxID
}
