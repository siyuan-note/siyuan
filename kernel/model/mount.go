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
	"path/filepath"
	"runtime/debug"
	"strings"
	"time"

	"github.com/88250/gulu"
	"github.com/88250/lute/ast"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func CreateBox(name string) (id string, err error) {
	WaitForWritingFiles()
	writingDataLock.Lock()
	defer writingDataLock.Unlock()

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
	return
}

func RenameBox(boxID, name string) (err error) {
	WaitForWritingFiles()
	writingDataLock.Lock()
	defer writingDataLock.Unlock()

	box := Conf.Box(boxID)
	if nil == box {
		return errors.New(Conf.Language(0))
	}

	boxConf := box.GetConf()
	boxConf.Name = name
	box.Name = name
	box.SaveConf(boxConf)
	IncSync()
	return
}

func RemoveBox(boxID string) (err error) {
	WaitForWritingFiles()
	writingDataLock.Lock()
	defer writingDataLock.Unlock()

	if util.IsReservedFilename(boxID) {
		return errors.New(fmt.Sprintf("can not remove [%s] caused by it is a reserved file", boxID))
	}

	localPath := filepath.Join(util.DataDir, boxID)
	if !gulu.File.IsExist(localPath) {
		return
	}
	if !gulu.File.IsDir(localPath) {
		return errors.New(fmt.Sprintf("can not remove [%s] caused by it is not a dir", boxID))
	}

	filelock.ReleaseFileLocks(localPath)
	if !isUserGuide(boxID) {
		var historyDir string
		historyDir, err = util.GetHistoryDir("delete")
		if nil != err {
			util.LogErrorf("get history dir failed: %s", err)
			return
		}
		p := strings.TrimPrefix(localPath, util.DataDir)
		historyPath := filepath.Join(historyDir, p)
		if err = gulu.File.Copy(localPath, historyPath); nil != err {
			util.LogErrorf("gen sync history failed: %s", err)
			return
		}

		copyBoxAssetsToDataAssets(boxID)
	}

	unmount0(boxID)
	if err = os.RemoveAll(localPath); nil != err {
		return
	}
	IncSync()
	return
}

func Unmount(boxID string) {
	WaitForWritingFiles()
	writingDataLock.Lock()
	defer writingDataLock.Unlock()

	unmount0(boxID)
	evt := util.NewCmdResult("unmount", 0, util.PushModeBroadcast, 0)
	evt.Data = map[string]interface{}{
		"box": boxID,
	}
	util.PushEvent(evt)
}

func unmount0(boxID string) {
	for _, box := range Conf.GetOpenedBoxes() {
		if box.ID == boxID {
			boxConf := box.GetConf()
			boxConf.Closed = true
			box.SaveConf(boxConf)
			box.Unindex()
			debug.FreeOSMemory()
			return
		}
	}
}

func Mount(boxID string) (alreadyMount bool, err error) {
	WaitForWritingFiles()
	writingDataLock.Lock()
	defer writingDataLock.Unlock()

	localPath := filepath.Join(util.DataDir, boxID)

	var reMountGuide bool
	if isUserGuide(boxID) {
		// 重新挂载帮助文档

		guideBox := Conf.Box(boxID)
		if nil != guideBox {
			unmount0(guideBox.ID)
			reMountGuide = true
		}

		if err = os.RemoveAll(localPath); nil != err {
			return
		}

		p := filepath.Join(util.WorkingDir, "guide", boxID)
		if err = gulu.File.Copy(p, localPath); nil != err {
			return
		}

		if box := Conf.Box(boxID); nil != box {
			boxConf := box.GetConf()
			boxConf.Closed = true
			box.SaveConf(boxConf)
		}

		if Conf.Newbie {
			Conf.Newbie = false
			Conf.Save()
		}

		go func() {
			time.Sleep(time.Second * 5)
			util.PushErrMsg(Conf.Language(52), 9000)

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

	box.Index(false)
	IndexRefs()
	// 缓存根一级的文档树展开
	ListDocTree(box.ID, "/", Conf.FileTree.Sort)
	treenode.SaveBlockTree()
	util.ClearPushProgress(100)
	if reMountGuide {
		return true, nil
	}
	return false, nil
}

func isUserGuide(boxID string) bool {
	return "20210808180117-czj9bvb" == boxID || "20210808180117-6v0mkxr" == boxID || "20211226090932-5lcq56f" == boxID
}
