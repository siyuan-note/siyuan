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
	"time"
	"unicode/utf8"

	"github.com/88250/gulu"
	"github.com/88250/lute/ast"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func CreateBox(name string) (id string, err error) {
	name = gulu.Str.RemoveInvisible(name)
	if 512 < utf8.RuneCountInString(name) {
		// 限制笔记本名和文档名最大长度为 `512` https://github.com/siyuan-note/siyuan/issues/6299
		err = errors.New(Conf.Language(106))
		return
	}

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

	if !IsUserGuide(boxID) {
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
	WaitForWritingFiles()

	localPath := filepath.Join(util.DataDir, boxID)
	var reMountGuide bool
	if IsUserGuide(boxID) {
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
	treenode.SaveBlockTree(false)
	util.ClearPushProgress(100)

	if IsUserGuide(boxID) {
		go func() {
			var startID string
			i := 0
			for ; i < 70; i++ {
				time.Sleep(100 * time.Millisecond)
				guideStartID := map[string]string{
					"20210808180117-czj9bvb": "20200812220555-lj3enxa",
					"20211226090932-5lcq56f": "20211226115423-d5z1joq",
					"20210808180117-6v0mkxr": "20200923234011-ieuun1p",
				}
				startID = guideStartID[boxID]
				if nil != treenode.GetBlockTree(startID) {
					util.BroadcastByType("main", "openFileById", 0, "", map[string]interface{}{
						"id": startID,
					})
					break
				}
			}
		}()
	}

	if reMountGuide {
		return true, nil
	}
	return false, nil
}

func IsUserGuide(boxID string) bool {
	return "20210808180117-czj9bvb" == boxID || "20210808180117-6v0mkxr" == boxID || "20211226090932-5lcq56f" == boxID
}
