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
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/task"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func GetBoxByName(name string) (ret *Box) {
	for _, box := range Conf.GetOpenedBoxes() {
		if box.Name == name {
			ret = box
			return
		}
	}
	return
}

func CreateBox(name string) (id string, err error) {
	name = normalizeBoxName(name)
	if 512 < utf8.RuneCountInString(name) {
		// 限制笔记本名和文档名最大长度为 `512` https://github.com/siyuan-note/siyuan/issues/6299
		err = errors.New(Conf.Language(106))
		return
	}
	FlushTxQueue()

	createDocLock.Lock()
	defer createDocLock.Unlock()

	boxes, _ := ListNotebooks()
	for i, b := range boxes {
		c := b.GetConf()
		c.Sort = i + 1
		if err := b.SaveConf(c); err != nil {
			logging.LogErrorf("save box conf [%s] failed: %s", b.ID, err)
		}
	}

	id = ast.NewNodeID()
	boxLocalPath := filepath.Join(util.DataDir, id)
	err = os.MkdirAll(boxLocalPath, 0755)
	if err != nil {
		return
	}

	box := &Box{ID: id, Name: name}
	boxConf := box.GetConf()
	boxConf.Name = name
	if err := box.SaveConf(boxConf); err != nil {
		logging.LogErrorf("save box conf [%s] failed: %s", id, err)
	}
	if _, err = ensureBoxDoc0(id); err != nil {
		treenode.RemoveBlockTreesByBoxID(id)
		sql.DeleteBoxQueue(id)
		if removeErr := filelock.Remove(boxLocalPath); nil != removeErr {
			logging.LogErrorf("remove box [%s] after initializing box document failed: %s", id, removeErr)
		}
		return "", err
	}
	IncSync()
	logging.LogInfof("created box [%s]", id)
	return
}

func RenameBox(boxID, name string) (err error) {
	box := Conf.Box(boxID)
	if nil == box {
		return errors.New(Conf.Language(0))
	}

	name = normalizeBoxName(name)
	if 512 < utf8.RuneCountInString(name) {
		// 限制笔记本名和文档名最大长度为 `512` https://github.com/siyuan-note/siyuan/issues/6299
		err = errors.New(Conf.Language(106))
		return
	}

	boxConf := box.GetConf()
	boxConf.Name = name
	box.Name = name
	if err = box.SaveConf(boxConf); err != nil {
		logging.LogErrorf("save box conf [%s] failed: %s", boxID, err)
		return
	}
	if err = renameBoxDoc(boxID, name); err != nil {
		logging.LogErrorf("rename box document [box=%s] failed: %s", boxID, err)
		return
	}
	IncSync()
	logging.LogInfof("renamed box [%s] to [%s]", boxID, name)
	return
}

func normalizeBoxName(name string) string {
	name = normalizeDocTitle(name)
	if "" == name {
		name = normalizeDocTitle(Conf.language(105))
	}
	return name
}

var boxLock = sync.Map{}

func RemoveBox(boxID string) (err error) {
	if _, ok := boxLock.Load(boxID); ok {
		err = errors.New(Conf.language(239))
		return
	}

	boxLock.Store(boxID, true)
	defer boxLock.Delete(boxID)

	if util.IsReservedFilename(boxID) {
		return fmt.Errorf("can not remove [%s] caused by it is a reserved file", boxID)
	}

	FlushTxQueue()
	isUserGuide := IsUserGuide(boxID)
	createDocLock.Lock()
	defer createDocLock.Unlock()

	localPath := filepath.Join(util.DataDir, boxID)
	if !filelock.IsExist(localPath) {
		return
	}
	if !gulu.File.IsDir(localPath) {
		return fmt.Errorf("can not remove [%s] caused by it is not a dir", boxID)
	}

	unmount0(boxID)

	// 删目录前缓存加密状态：删目录后 conf.json 不复存在，IsEncryptedBox 会返回 false
	isEncrypted := IsEncryptedBox(boxID)

	if !isUserGuide {
		var historyDir string
		historyDir, err = getHistoryDir(HistoryOpDelete)
		if err != nil {
			logging.LogErrorf("get history dir failed: %s", err)
			return
		}
		// 删除前备份到历史目录（密文原样拷贝，加密笔记本的整个目录保持密文）
		p := strings.TrimPrefix(localPath, util.DataDir)
		historyPath := filepath.Join(historyDir, p)
		if err = filelock.Copy(localPath, historyPath); err != nil {
			logging.LogErrorf("gen sync history failed: %s", err)
			return
		}

		// 加密笔记本的 assets 不提升到全局 data/assets，避免密文污染全局或被全局索引
		if !isEncrypted {
			copyBoxAssetsToDataAssets(boxID)
		}
	}

	// 加密笔记本删除前先清理导出临时目录并撤销托管下载注册表。
	// 必须在 filelock.Remove 之前执行：若 box 目录删除失败导致提前 return，导出清理仍已完成，
	// 避免明文产物在 IsEncryptedBox 返回 false 后被 fail-open 下载
	if isEncrypted {
		if rmErr := os.RemoveAll(filepath.Join(util.TempDir, "export", boxID)); rmErr != nil {
			logging.LogWarnf("remove export/[%s] dir failed: %s", boxID, rmErr)
		}
		RevokeManagedEncryptedExportsForBox(boxID)
	}

	if err = filelock.Remove(localPath); err != nil {
		return
	}
	// 加密笔记本删除时清理其独立加密 db 文件（含 WAL/SHM），避免残留
	if isEncrypted {
		sql.RemoveEncryptedDBFile(boxID)
		treenode.RemoveEncryptedBlockTreeDBFile(boxID)
	}

	if isUserGuide {
		if avFiles, readAvErr := getUserGuideAVJSONFiles(boxID); nil == readAvErr {
			for _, avName := range avFiles {
				avFilePath := filepath.Join(util.DataDir, "storage", "av", avName)
				if removeErr := filelock.Remove(avFilePath); nil != removeErr {
					logging.LogErrorf("remove av file [%s] failed: %s", avFilePath, removeErr)
				} else {
					logging.LogDebugf("removed av file [%s]", avFilePath)
				}
			}
		}
	}

	IncSync()

	logging.LogInfof("removed box [%s]", boxID)
	return
}

func Unmount(boxID string) {
	FlushTxQueue()

	unmount0(boxID)

	cmdName := "closeBox"
	if IsUserGuide(boxID) {
		if err := RemoveBox(boxID); err == nil {
			cmdName = "removeBox"
		} else {
			logging.LogErrorf("close user guide box [%s] failed, fallback to unmount: %s", boxID, err)
		}
	}
	evt := util.NewCmdResult(cmdName, 0, util.PushModeBroadcast)
	evt.Data = map[string]any{
		"box": boxID,
	}
	util.PushEvent(evt)
	if cmdName == "removeBox" {
		TriggerOnboardingIfEmpty()
	}
}

// clearDEKIfUnlockedEncryptedBox 清除已解锁但未挂载的加密笔记本的 DEK。
// unmount0 在 box 未挂载（Conf.Box 返回 nil）时调用，覆盖 unlockBox 解锁后未 mount 即 lock 的场景：
// 此时 DEK 仍在内存，若不清除，锁定后认证 API 仍可读取明文。
func clearDEKIfUnlockedEncryptedBox(boxID string) {
	if IsEncryptedBox(boxID) && IsBoxUnlocked(boxID) {
		ClearDEK(boxID)
	}
}

func unmount0(boxID string) {
	box := Conf.Box(boxID)
	if nil == box {
		// 笔记本未挂载（Closed）。若它是已解锁的加密笔记本（DEK 在内存），
		// 仍需 ClearDEK 清除残留密钥材料，否则锁定后认证 API 仍可读取明文。
		clearDEKIfUnlockedEncryptedBox(boxID)
		return
	}

	boxConf := box.GetConf()
	boxConf.Closed = true
	if err := box.SaveConf(boxConf); err != nil {
		logging.LogErrorf("save box conf [%s] failed: %s", box.ID, err)
	}
	if IsEncryptedBox(box.ID) {
		// 加密笔记本关闭：跳过 Unindex（索引 db 马上要删，逐条删是白费），
		// 先等待事务队列和 SQL 索引队列落盘（确保 pending 写入已持久化到加密 .sy），
		// 生成文件历史，再 ClearDEK（=LockBox）清除 DEK 并删除加密 db 文件。
		// 加密索引可由 box.Index() 全量重建，关闭即删文件避免残留旧索引数据导致下次解锁叠加重复行。
		FlushTxQueue()
		sql.FlushQueue()
		// 关闭前生成一次文件历史：锁定后定时器无法为加密笔记本生成历史（不在 GetOpenedBoxes 里）
		GenerateFileHistoryForBox(box)
		ClearDEK(boxID)
	} else {
		box.Unindex()
	}
}

func Mount(boxID string) (alreadyMount bool, err error) {
	if _, ok := boxLock.Load(boxID); ok {
		err = errors.New(Conf.language(239))
		return
	}

	boxLock.Store(boxID, true)
	defer boxLock.Delete(boxID)

	FlushTxQueue()
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

		if err = filelock.Remove(localPath); err != nil {
			return
		}

		boxes, _ := ListNotebooks()
		var sort int
		if len(boxes) > 0 {
			sort = boxes[0].Sort - 1
		}

		p := filepath.Join(util.WorkingDir, "guide", boxID)
		if err = filelock.Copy(p, localPath); err != nil {
			return
		}

		// 清除所有缓存，确保重开用户指南时数据是最新的
		cache.ClearTreeCache()
		cache.ClearDocsIAL()
		cache.ClearBlocksIAL()
		cache.ClearAVCache()

		avDirPath := filepath.Join(util.WorkingDir, "guide", boxID, "storage", "av")
		if filelock.IsExist(avDirPath) {
			if err = filelock.Copy(avDirPath, filepath.Join(util.DataDir, "storage", "av")); err != nil {
				return
			}
		}

		if box := Conf.Box(boxID); nil != box {
			boxConf := box.GetConf()
			boxConf.Closed = true
			boxConf.Sort = sort
			box.SaveConf(boxConf)
		}

		task.AppendAsyncTaskWithDelay(task.PushMsg, 3*time.Second, util.PushErrMsg, Conf.Language(244), 7000)
		go func() {
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

	// 加密笔记本必须先通过 UnlockBox 解出 DEK，否则拒绝挂载。Mount 本身不接收密码，
	// 前端流程为：先调 /api/notebook/unlockBox 解锁，再调 openNotebook 挂载。
	// 使用 IsEncryptedBox 统一判定（含 backup fallback，不依赖 conf 完整性）。
	if IsEncryptedBox(boxID) && !IsBoxUnlocked(boxID) {
		return false, errors.New("encrypted notebook locked, please unlock it first")
	}

	box := &Box{ID: boxID}
	boxConf := box.GetConf()
	boxConf.Closed = false
	if err := box.SaveConf(boxConf); err != nil {
		logging.LogErrorf("save box conf [%s] failed: %s", boxID, err)
	}
	if _, ensureErr := EnsureBoxDoc(boxID); nil != ensureErr {
		logging.LogErrorf("ensure box document [%s] failed: %s", boxID, ensureErr)
	}

	// 缓存根一级的文档树展开
	files, _, _ := ListDocTree(box.ID, "/", util.SortModeUnassigned, false, false, Conf.FileTree.MaxListCount)
	box = Conf.Box(boxID)
	if 0 < len(files) || (nil != box && box.Exist(boxDocPath(box.ID))) {
		box.Index()
	}

	if reMountGuide {
		return true, nil
	}
	return false, nil
}

func IsUserGuide(boxID string) bool {
	return "20210808180117-czj9bvb" == boxID || "20210808180117-6v0mkxr" == boxID || "20211226090932-5lcq56f" == boxID || "20240530133126-axarxgx" == boxID
}

func getUserGuideAVJSONFiles(boxID string) (ret []string, err error) {
	guideAVDirPath := filepath.Join(util.WorkingDir, "guide", boxID, "storage", "av")
	if !filelock.IsExist(guideAVDirPath) {
		logging.LogErrorf("guide av dir [%s] not exist", guideAVDirPath)
		return
	}

	avEntries, err := os.ReadDir(guideAVDirPath)
	if nil != err {
		logging.LogErrorf("read guide av dir [%s] failed: %s", guideAVDirPath, err)
		return
	}

	for _, avEntry := range avEntries {
		avName := avEntry.Name()
		if avEntry.IsDir() || !strings.HasSuffix(avName, ".json") || !ast.IsNodeIDPattern(strings.TrimSuffix(avName, ".json")) {
			continue
		}
		ret = append(ret, avName)
	}
	return
}

func getAllUserGuideAVJSONFiles() (ret []string) {
	guideDirPath := filepath.Join(util.WorkingDir, "guide")
	guideEntries, err := os.ReadDir(guideDirPath)
	if nil != err {
		return
	}

	for _, guideEntry := range guideEntries {
		boxID := guideEntry.Name()
		if !guideEntry.IsDir() || !IsUserGuide(boxID) {
			continue
		}

		avFiles, err := getUserGuideAVJSONFiles(boxID)
		if nil != err {
			continue
		}
		ret = append(ret, avFiles...)
	}
	return
}
