// SiYuan - From thought to insight, with agents
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

package api

import (
	"io"
	"sort"
	"strings"
	"time"

	"github.com/88250/gulu"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var getNotebookInfo = contractHandler(apicontract.GetNotebookInfo, func(c *gin.Context, request apicontract.NotebookIDRequest) apicontract.Response[apicontract.NotebookInfoData] {
	ret := gulu.Ret.NewResult()
	boxID := request.Notebook
	if util.InvalidIDPattern(boxID, ret) {
		return contractFailure[apicontract.NotebookInfoData](ret)
	}

	box := model.Conf.Box(boxID)
	if nil == box {
		ret.Code = -1
		ret.Msg = "notebook [" + boxID + "] not found"
		return contractFailure[apicontract.NotebookInfoData](ret)
	}
	if model.IsReadOnlyRoleContext(c) && !isNotebookVisibleByPublishAccess(box, model.GetPublishAccess()) {
		ret.Code = -1
		ret.Msg = "notebook [" + boxID + "] not found"
		return contractFailure[apicontract.NotebookInfoData](ret)
	}
	if err := holdEncryptedBoxRequest(c, boxID); err != nil {
		ret.Code = -1
		ret.Msg = model.Conf.Language(314)
		return contractFailure[apicontract.NotebookInfoData](ret)
	}

	var boxInfo *model.BoxInfo
	if model.IsReadOnlyRoleContext(c) {
		// 发布读者的统计口径与可见的发布视图一致，不包含隐藏和禁止发布的文档
		boxInfo = box.GetInfoForPublish(model.GetPublishAccess())
	} else {
		boxInfo = box.GetInfo()
	}
	return apicontract.Success(apicontract.NotebookInfoData{BoxInfo: notebookInfoContract(boxInfo)})
})

var setNotebookIcon = contractHandler(apicontract.SetNotebookIcon, func(c *gin.Context, request apicontract.SetNotebookIconRequest) apicontract.Response[apicontract.Null] {
	ret := gulu.Ret.NewResult()
	boxID, icon := request.Notebook, request.Icon

	if util.InvalidIDPattern(boxID, ret) {
		return contractFailure[apicontract.Null](ret)
	}
	if err := holdEncryptedBoxRequest(c, boxID); err != nil {
		ret.Code = -1
		ret.Msg = model.Conf.Language(314)
		return contractFailure[apicontract.Null](ret)
	}
	model.SetBoxIcon(boxID, icon)
	return apicontract.Success(apicontract.Null{})
})

var changeSortNotebook = contractHandler(apicontract.ChangeSortNotebook, func(c *gin.Context, request apicontract.ChangeSortNotebookRequest) apicontract.Response[apicontract.Null] {
	ret := gulu.Ret.NewResult()
	ids := request.Notebooks

	for _, id := range ids {
		if err := holdEncryptedBoxRequest(c, id); err != nil {
			ret.Code = -1
			ret.Msg = model.Conf.Language(314)
			return contractFailure[apicontract.Null](ret)
		}
	}
	model.ChangeBoxSort(ids)
	return apicontract.Success(apicontract.Null{})
})

var reorderNotebooks = contractHandler(apicontract.ReorderNotebooks, func(c *gin.Context, request apicontract.ReorderNotebooksRequest) apicontract.Response[*apicontract.ReorderData] {
	ret := gulu.Ret.NewResult()
	if !validateReorderRequest(request.SourceIDs, request.TargetID, request.Position, ret) {
		return contractFailure[*apicontract.ReorderData](ret)
	}

	result, err := model.ReorderNotebooks(request.SourceIDs, request.TargetID, request.Position)
	var data *apicontract.ReorderData
	if result != nil {
		data = &apicontract.ReorderData{Changed: result.Changed, Notebook: result.Notebook, ParentPath: result.ParentPath}
	}
	if nil != err {
		return apicontract.ReorderNotebooks.FailureWithData(-1, err.Error(), data)
	}
	return apicontract.Success(data)
})

var renameNotebook = contractHandler(apicontract.RenameNotebook, func(c *gin.Context, request apicontract.RenameNotebookRequest) apicontract.Response[apicontract.Null] {
	ret := gulu.Ret.NewResult()
	notebook, name := request.Notebook, request.Name

	if util.InvalidIDPattern(notebook, ret) {
		return contractFailure[apicontract.Null](ret)
	}
	if err := holdEncryptedBoxRequest(c, notebook); err != nil {
		ret.Code = -1
		ret.Msg = model.Conf.Language(314)
		return contractFailure[apicontract.Null](ret)
	}
	err := model.RenameBox(notebook, name)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return apicontract.FailureWithTimeout[apicontract.Null](ret.Code, ret.Msg, 5000)
	}

	evt := util.NewCmdResult("renamenotebook", 0, util.PushModeBroadcast)
	evt.Data = map[string]any{
		"box":  notebook,
		"name": name,
	}
	util.PushEvent(evt)
	return apicontract.Success(apicontract.Null{})
})

var removeNotebook = contractHandler(apicontract.RemoveNotebook, func(c *gin.Context, request apicontract.NotebookIDRequest) apicontract.Response[apicontract.Null] {
	ret := gulu.Ret.NewResult()
	notebook := request.Notebook

	if util.InvalidIDPattern(notebook, ret) {
		return contractFailure[apicontract.Null](ret)
	}

	if util.ReadOnly && !model.IsUserGuide(notebook) {
		ret.Code = -1
		ret.Msg = model.Conf.Language(34)
		return apicontract.FailureWithTimeout[apicontract.Null](ret.Code, ret.Msg, 5000)
	}

	err := model.RemoveBox(notebook)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return contractFailure[apicontract.Null](ret)
	}

	evt := util.NewCmdResult("removeBox", 0, util.PushModeBroadcast)
	evt.Data = map[string]any{
		"box": notebook,
	}
	util.PushEvent(evt)
	model.TriggerOnboardingIfEmpty()
	return apicontract.Success(apicontract.Null{})
})

var createNotebook = contractHandler(apicontract.CreateNotebook, func(c *gin.Context, request apicontract.CreateNotebookRequest) apicontract.Response[apicontract.CreateNotebookData] {
	ret := gulu.Ret.NewResult()
	name := request.Name

	id, err := model.CreateBox(name)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return contractFailure[apicontract.CreateNotebookData](ret)
	}

	existed, err := model.Mount(id)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return contractFailure[apicontract.CreateNotebookData](ret)
	}

	box := model.Conf.Box(id)
	if nil == box {
		ret.Code = -1
		ret.Msg = "opened notebook [" + id + "] not found"
		return contractFailure[apicontract.CreateNotebookData](ret)
	}

	evt := util.NewCmdResult("createnotebook", 0, util.PushModeBroadcast)
	evt.Data = map[string]any{
		"box":     box,
		"existed": existed,
	}
	util.PushEvent(evt)
	return apicontract.Success(apicontract.CreateNotebookData{Notebook: notebookContract(box)})
})

var openNotebook = contractHandler(apicontract.OpenNotebook, func(c *gin.Context, request apicontract.OpenNotebookRequest) apicontract.Response[apicontract.Null] {
	ret := gulu.Ret.NewResult()
	notebook := request.Notebook

	if util.InvalidIDPattern(notebook, ret) {
		return contractFailure[apicontract.Null](ret)
	}

	isUserGuide := model.IsUserGuide(notebook)
	if util.ReadOnly && !isUserGuide {
		ret.Code = -1
		ret.Msg = model.Conf.Language(34)
		return apicontract.FailureWithTimeout[apicontract.Null](ret.Code, ret.Msg, 5000)
	}
	if err := holdEncryptedBoxRequest(c, notebook); err != nil {
		ret.Code = -1
		ret.Msg = model.Conf.Language(314)
		return contractFailure[apicontract.Null](ret)
	}

	msgId := util.PushMsg(model.Conf.Language(45), 1000*60*15)
	defer util.PushClearMsg(msgId)
	existed, err := model.Mount(notebook)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return contractFailure[apicontract.Null](ret)
	}

	box := model.Conf.Box(notebook)
	if nil == box {
		ret.Code = -1
		ret.Msg = "opened notebook [" + notebook + "] not found"
		return contractFailure[apicontract.Null](ret)
	}

	evt := util.NewCmdResult("mount", 0, util.PushModeBroadcast)
	evt.Data = map[string]any{
		"box":     box,
		"existed": existed,
	}
	util.PushEvent(evt)

	if isUserGuide {
		app := request.App

		go func() {
			var startID string
			i := 0
			for ; i < 70; i++ {
				time.Sleep(100 * time.Millisecond)
				guideStartID := map[string]string{
					"20210808180117-czj9bvb": "20200812220555-lj3enxa",
					"20211226090932-5lcq56f": "20211226115423-d5z1joq",
					"20210808180117-6v0mkxr": "20200923234011-ieuun1p",
					"20240530133126-axarxgx": "20240530101000-4qitucx",
				}
				startID = guideStartID[notebook]
				if treenode.ExistBlockTree(startID) {
					util.BroadcastByTypeAndApp("main", app, "openFileById", 0, "", map[string]any{
						"id": startID,
					})
					break
				}
			}
		}()
	}
	return apicontract.Success(apicontract.Null{})
})

var closeNotebook = contractHandler(apicontract.CloseNotebook, func(c *gin.Context, request apicontract.CloseNotebookRequest) apicontract.Response[apicontract.Null] {
	ret := gulu.Ret.NewResult()
	notebook := request.Notebook

	if util.InvalidIDPattern(notebook, ret) {
		return contractFailure[apicontract.Null](ret)
	}
	model.Unmount(notebook)
	return apicontract.Success(apicontract.Null{})
})

var getNotebookConf = contractHandler(apicontract.GetNotebookConf, func(c *gin.Context, request apicontract.CloseNotebookRequest) apicontract.Response[apicontract.NotebookConfData] {
	ret := gulu.Ret.NewResult()
	notebook := request.Notebook

	if util.InvalidIDPattern(notebook, ret) {
		return contractFailure[apicontract.NotebookConfData](ret)
	}

	box := model.Conf.GetBox(notebook)
	if nil == box {
		ret.Code = -1
		ret.Msg = "notebook [" + notebook + "] not found"
		return contractFailure[apicontract.NotebookConfData](ret)
	}
	if model.IsReadOnlyRoleContext(c) && !isNotebookVisibleByPublishAccess(box, model.GetPublishAccess()) {
		ret.Code = -1
		ret.Msg = "notebook [" + notebook + "] not found"
		return contractFailure[apicontract.NotebookConfData](ret)
	}
	if model.IsBoxUnlocked(notebook) {
		if err := holdEncryptedBoxRequest(c, notebook); err != nil {
			ret.Code = -1
			ret.Msg = model.Conf.Language(314)
			return contractFailure[apicontract.NotebookConfData](ret)
		}
	}

	boxConf := box.GetConf()
	if !model.IsAdminRoleContext(c) {
		model.HideBoxConfSecret(boxConf)
	}

	return apicontract.Success(apicontract.NotebookConfData{Box: box.ID, Name: box.Name, Conf: notebookConfContract(boxConf)})
})

var setNotebookConf = contractHandler(apicontract.SetNotebookConf, func(c *gin.Context, request apicontract.SetNotebookConfRequest) apicontract.Response[*apicontract.NotebookConf] {
	ret := gulu.Ret.NewResult()
	notebook := request.Notebook

	if util.InvalidIDPattern(notebook, ret) {
		return contractFailure[*apicontract.NotebookConf](ret)
	}

	box := model.Conf.GetBox(notebook)
	if nil == box {
		ret.Code = -1
		ret.Msg = "notebook [" + notebook + "] not found"
		return contractFailure[*apicontract.NotebookConf](ret)
	}
	if model.IsBoxUnlocked(notebook) {
		if err := holdEncryptedBoxRequest(c, notebook); err != nil {
			ret.Code = -1
			ret.Msg = model.Conf.Language(314)
			return contractFailure[*apicontract.NotebookConf](ret)
		}
	}

	boxConf := box.GetConf()
	oldSortMode := boxConf.SortMode
	applyNotebookConfPatch(boxConf, request.Conf)

	boxConf.DocCreateSavePath = util.TrimSpaceInPath(boxConf.DocCreateSavePath)
	boxConf.DocCreateTemplatePath = util.NormalizeTemplatePath(boxConf.DocCreateTemplatePath)

	boxConf.RefCreateSavePath = util.TrimSpaceInPath(boxConf.RefCreateSavePath)

	boxConf.DailyNoteSavePath = util.TrimSpaceInPath(boxConf.DailyNoteSavePath)
	if "" != boxConf.DailyNoteSavePath {
		if !strings.HasPrefix(boxConf.DailyNoteSavePath, "/") {
			boxConf.DailyNoteSavePath = "/" + boxConf.DailyNoteSavePath
		}
	}
	if "/" == boxConf.DailyNoteSavePath {
		ret.Code = -1
		ret.Msg = model.Conf.Language(49)
		return contractFailure[*apicontract.NotebookConf](ret)
	}

	boxConf.DailyNoteTemplatePath = util.NormalizeTemplatePath(boxConf.DailyNoteTemplatePath)

	if err := box.SaveConfAndSync(boxConf); err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return contractFailure[*apicontract.NotebookConf](ret)
	}
	if oldSortMode != boxConf.SortMode {
		model.PushDocSortModeChanged("notebook", notebook, "", "/", &boxConf.SortMode)
	}
	return apicontract.Success(notebookConfContract(boxConf))
})

var lsNotebooks = contractHandler(apicontract.ListNotebooks, func(c *gin.Context, request apicontract.ListNotebooksRequest) apicontract.Response[*apicontract.ListNotebooksData] {
	ret := gulu.Ret.NewResult()

	flashcard := request.Flashcard

	var notebooks []*model.Box
	var publishAccess model.PublishAccess
	isReadOnlyRole := model.IsReadOnlyRoleContext(c)
	if flashcard {
		notebooks = model.GetFlashcardNotebooks()
	} else {
		for _, boxID := range model.ListAllEncryptedBoxIDs() {
			if !model.IsBoxUnlocked(boxID) {
				continue
			}
			if err := holdEncryptedBoxRequest(c, boxID); err != nil {
				ret.Code = -1
				ret.Msg = model.Conf.Language(314)
				return contractFailure[*apicontract.ListNotebooksData](ret)
			}
		}
		var err error
		notebooks, err = model.ListNotebooks()
		if err != nil {
			return apicontract.Success[*apicontract.ListNotebooksData](nil)
		}
		if isReadOnlyRole {
			publishAccess = model.GetPublishAccess()
			tempNotebooks := []*model.Box{}
			for _, notebook := range notebooks {
				if !isNotebookVisibleByPublishAccess(notebook, publishAccess) {
					continue
				}
				tempNotebooks = append(tempNotebooks, notebook)
			}
			notebooks = tempNotebooks
		}
	}

	boxDocEnabled := model.IsBoxDocEnabled()
	if !flashcard && boxDocEnabled {
		for _, notebook := range notebooks {
			if !notebook.Closed {
				if isReadOnlyRole {
					notebook.SubFileCount = model.BoxDocSubFileCountForPublish(notebook.ID, publishAccess)
				} else {
					notebook.SubFileCount = model.BoxDocSubFileCount(notebook.ID)
				}
			}
		}
		sortNotebooksBySubFileCount(notebooks, model.Conf.FileTree.Sort)
	}

	var values []*apicontract.Notebook
	if notebooks != nil {
		values = make([]*apicontract.Notebook, 0, len(notebooks))
		for _, notebook := range notebooks {
			values = append(values, notebookContract(notebook))
		}
	}
	return apicontract.Success(&apicontract.ListNotebooksData{Notebooks: values, BoxDocEnabled: boxDocEnabled})
})

func sortNotebooksBySubFileCount(notebooks []*model.Box, sortMode int) {
	switch sortMode {
	case util.SortModeSubDocCountASC:
		sort.SliceStable(notebooks, func(i, j int) bool {
			return notebooks[i].SubFileCount < notebooks[j].SubFileCount
		})
	case util.SortModeSubDocCountDESC:
		sort.SliceStable(notebooks, func(i, j int) bool {
			return notebooks[i].SubFileCount > notebooks[j].SubFileCount
		})
	}
}

func isNotebookVisibleByPublishAccess(notebook *model.Box, publishAccess model.PublishAccess) bool {
	if nil == notebook || notebook.Closed || notebook.Encrypted {
		return false
	}

	for _, item := range publishAccess {
		if item.ID == notebook.ID {
			return item.Visible
		}
	}
	return true
}

// enableEncryptedNotebooks 先同步数据，再恢复既有配置或启用加密笔记本并设置主密码。
var enableEncryptedNotebooks = contractHandler(apicontract.EnableEncryptedNotebooks, func(c *gin.Context, request apicontract.NotebookPasswordRequest) apicontract.Response[apicontract.Null] {
	ret := gulu.Ret.NewResult()
	password := request.Password

	if err := model.EnableEncryptedNotebookWithSync(password); err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return contractFailure[apicontract.Null](ret)
	}
	return apicontract.Success(apicontract.Null{})
})

// disableEncryptedNotebooks 关闭加密笔记本功能。前置：没有加密笔记本存在。
var disableEncryptedNotebooks = contractHandler(apicontract.DisableEncryptedNotebooks, func(c *gin.Context, request apicontract.EmptyRequest) apicontract.Response[apicontract.Null] {
	ret := gulu.Ret.NewResult()
	if err := model.DisableEncryptedNotebook(); err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return contractFailure[apicontract.Null](ret)
	}
	return apicontract.Success(apicontract.Null{})
})

// createEncryptedNotebook 创建一个新的加密笔记本。前置：加密功能已启用。
// 创建时需提供主密码（用于派生 KEK 包络 DEK）。创建成功后内核已原子完成挂载。
var createEncryptedNotebook = contractHandler(apicontract.CreateEncryptedNotebook, func(c *gin.Context, request apicontract.CreateEncryptedNotebookRequest) apicontract.Response[apicontract.CreateNotebookData] {
	ret := gulu.Ret.NewResult()
	name, password := request.Name, request.Password

	id, err := model.CreateEncryptedBox(name, password)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return contractFailure[apicontract.CreateNotebookData](ret)
	}
	if err = holdEncryptedBoxRequest(c, id); err != nil {
		ret.Code = -1
		ret.Msg = model.Conf.Language(314)
		return contractFailure[apicontract.CreateNotebookData](ret)
	}

	// 创建时 DEK 已缓存 + 加密 db 已打开，此处直接挂载；失败则锁定回滚，避免 DEK 残留
	existed, err := model.Mount(id)
	if err != nil {
		releaseEncryptedBoxRequest(c, id)
		model.LockBox(id)
		ret.Code = -1
		ret.Msg = err.Error()
		return contractFailure[apicontract.CreateNotebookData](ret)
	}

	box := model.Conf.Box(id)
	evt := util.NewCmdResult("mount", 0, util.PushModeBroadcast)
	evt.Data = map[string]any{
		"box":     box,
		"existed": existed,
	}
	util.PushEvent(evt)

	return apicontract.Success(apicontract.CreateNotebookData{Notebook: notebookContract(box)})
})

// unlockNotebook 用主密码派生 KEK 并解出指定加密笔记本的 DEK，缓存到内存。
// 解锁后该笔记本即可被 Mount。每次调用跑一次 Argon2id（约 1 秒）。
var unlockNotebook = contractHandler(apicontract.UnlockNotebook, func(c *gin.Context, request apicontract.UnlockNotebookRequest) apicontract.Response[apicontract.Null] {
	ret := gulu.Ret.NewResult()
	notebook, password := request.Notebook, request.Password

	if util.InvalidIDPattern(notebook, ret) {
		return contractFailure[apicontract.Null](ret)
	}

	boxCrypt, err := model.GetBoxEncryption(notebook)
	if err != nil {
		ret.Code = -1
		ret.Msg = model.Conf.Language(318)
		return contractFailure[apicontract.Null](ret)
	}
	if boxCrypt == nil || len(boxCrypt.WrappedDEK) == 0 {
		ret.Code = -1
		ret.Msg = model.Conf.Language(319)
		return contractFailure[apicontract.Null](ret)
	}

	if err := model.UnlockBox(notebook, password, boxCrypt); err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return contractFailure[apicontract.Null](ret)
	}
	if err = holdEncryptedBoxRequest(c, notebook); err != nil {
		ret.Code = -1
		ret.Msg = model.Conf.Language(314)
		return contractFailure[apicontract.Null](ret)
	}
	return apicontract.Success(apicontract.Null{})
})

// unlockAndOpenNotebook 原子化解锁并挂载加密笔记本，挂载失败时由模型层在同一转换锁内回滚本次解锁。
var unlockAndOpenNotebook = contractHandler(apicontract.UnlockAndOpenNotebook, func(c *gin.Context, request apicontract.UnlockNotebookRequest) apicontract.Response[apicontract.Null] {
	ret := gulu.Ret.NewResult()
	notebook, password := request.Notebook, request.Password

	if util.InvalidIDPattern(notebook, ret) {
		return contractFailure[apicontract.Null](ret)
	}

	boxCrypt, err := model.GetBoxEncryption(notebook)
	if err != nil {
		ret.Code = -1
		ret.Msg = model.Conf.Language(318)
		return contractFailure[apicontract.Null](ret)
	}
	if boxCrypt == nil || len(boxCrypt.WrappedDEK) == 0 {
		ret.Code = -1
		ret.Msg = model.Conf.Language(319)
		return contractFailure[apicontract.Null](ret)
	}

	msgId := util.PushMsg(model.Conf.Language(45), 1000*60*15)
	defer util.PushClearMsg(msgId)
	existed, err := model.UnlockAndMountBox(notebook, password, boxCrypt)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return contractFailure[apicontract.Null](ret)
	}
	if err = holdEncryptedBoxRequest(c, notebook); err != nil {
		ret.Code = -1
		ret.Msg = model.Conf.Language(314)
		return contractFailure[apicontract.Null](ret)
	}

	box := model.Conf.Box(notebook)
	if nil == box {
		releaseEncryptedBoxRequest(c, notebook)
		model.LockBox(notebook)
		ret.Code = -1
		ret.Msg = "opened notebook [" + notebook + "] not found"
		return contractFailure[apicontract.Null](ret)
	}

	evt := util.NewCmdResult("mount", 0, util.PushModeBroadcast)
	evt.Data = map[string]any{
		"box":     box,
		"existed": existed,
	}
	util.PushEvent(evt)
	return apicontract.Success(apicontract.Null{})
})

// lockNotebook 锁定指定加密笔记本：清除其 DEK 缓存并 Unmount。
var lockNotebook = contractHandler(apicontract.LockNotebook, func(c *gin.Context, request apicontract.NotebookIDRequest) apicontract.Response[apicontract.Null] {
	ret := gulu.Ret.NewResult()
	notebook := request.Notebook

	if util.InvalidIDPattern(notebook, ret) {
		return contractFailure[apicontract.Null](ret)
	}

	if !model.IsEncryptedBox(notebook) {
		ret.Code = -1
		ret.Msg = model.Conf.Language(319)
		return contractFailure[apicontract.Null](ret)
	}

	// Unmount 内部的 unmount0 会清 DEK + 关闭加密 db，无需单独 LockBox。
	// 反过来若先 LockBox 会关闭 db，导致 Unmount 的 Unindex 操作无 db 可用。
	model.Unmount(notebook)
	return apicontract.Success(apicontract.Null{})
})

// setNotebookCryptoAutoLock 设置加密笔记本自动锁定闲置分钟数。
var setNotebookCryptoAutoLock = contractHandler(apicontract.SetNotebookCryptoAutoLock, func(c *gin.Context, request apicontract.NotebookCryptoAutoLockRequest) apicontract.Response[apicontract.Null] {
	autoLockMinutes := request.AutoLockMinutes

	minutes := max(int(autoLockMinutes), 0)

	model.SetAutoLockMinutes(minutes)
	model.Conf.Save()
	return apicontract.Success(apicontract.Null{})
})

// touchEncryptedNotebooks 由前端真实用户交互或 headless 客户端显式保活调用，刷新已解锁加密笔记本的闲置计时。
var touchEncryptedNotebooks = contractHandler(apicontract.TouchEncryptedNotebooks, func(c *gin.Context, request apicontract.EmptyRequest) apicontract.Response[apicontract.Null] {
	model.TouchUnlockedEncryptedBoxes()
	return apicontract.Success(apicontract.Null{})
})

// changeMasterPassword 修改加密笔记本的主密码。
// 用旧密码校验后，用新密码派生新 KEK，重新加密 verifier 和所有加密笔记本的 WrappedDEK。
// 必须在所有加密笔记本都已锁定（DEK 不在内存）的状态下调用。
var changeMasterPassword = contractHandler(apicontract.ChangeMasterPassword, func(c *gin.Context, request apicontract.ChangeMasterPasswordRequest) apicontract.Response[apicontract.Null] {
	ret := gulu.Ret.NewResult()
	oldPassword, newPassword := request.OldPassword, request.NewPassword

	if err := model.ChangeMasterPassword(oldPassword, newPassword); err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return contractFailure[apicontract.Null](ret)
	}
	return apicontract.Success(apicontract.Null{})
})

// getEncryptedNotebookStatus 返回加密笔记本功能的启用状态和各笔记本解锁信息。
var getEncryptedNotebookStatus = contractHandler(apicontract.GetEncryptedNotebookStatus, func(c *gin.Context, request apicontract.EmptyRequest) apicontract.Response[apicontract.EncryptedNotebookStatusData] {
	model.NotebookCryptoMuLock()
	boxIDs := model.ListAllEncryptedBoxIDs()
	model.NotebookCryptoMuUnlock()
	pendingMigration, migrationBoxes := model.MasterPasswordMigrationStatus()
	// 历史目录中是否存在已删除加密笔记本的历史快照：其恢复依赖当前密钥备份，
	// 存在时前端禁用入口应拦截（与 DisableEncryptedNotebook 的后端检查对齐）
	hasHistoryDependency := model.HasEncryptedNotebookHistory()
	state := model.NotebookCryptoLifecycleState(len(boxIDs) > 0 || hasHistoryDependency)

	boxes := make([]apicontract.EncryptedNotebookStatus, 0, len(boxIDs))
	for _, id := range boxIDs {
		box := model.Conf.Box(id)
		name := ""
		if box != nil {
			name = box.Name
		}
		boxes = append(boxes, apicontract.EncryptedNotebookStatus{ID: id, Name: name, Unlocked: model.IsBoxUnlocked(id), State: string(model.GetEncryptedBoxState(id))})
	}

	return apicontract.Success(apicontract.EncryptedNotebookStatusData{
		Enabled: state == model.NotebookCryptoStateEnabled, State: string(state), Count: len(boxIDs), Boxes: boxes,
		MigrationPending: pendingMigration, MigrationBoxes: migrationBoxes, HasHistoryDependency: hasHistoryDependency,
	})
})

// exportNotebookCryptoBackup 导出密钥备份文件到 export 目录供下载。
// 备份文件不含主密码（salt 不保密、verifier 是密文），用户主动保存作为同步之外的独立恢复途径。
var exportNotebookCryptoBackup = contractHandler(apicontract.ExportNotebookCryptoBackup, func(c *gin.Context, request apicontract.EmptyRequest) apicontract.Response[apicontract.NotebookCryptoBackupData] {
	ret := gulu.Ret.NewResult()
	downloadPath, err := model.ExportNotebookCryptoBackup()
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return contractFailure[apicontract.NotebookCryptoBackupData](ret)
	}
	return apicontract.Success(apicontract.NotebookCryptoBackupData{File: downloadPath})
})

// importNotebookCryptoBackup 导入密钥备份文件，恢复加密配置。
// 用于新设备、重装或 RecoveryRequired 状态下手动恢复；完整且已启用的配置拒绝覆盖。
var importNotebookCryptoBackup = contractHandler(apicontract.ImportNotebookCryptoBackup, func(c *gin.Context, request apicontract.ImportNotebookCryptoBackupRequest) apicontract.Response[apicontract.Null] {
	ret := gulu.Ret.NewResult()
	fh := request.File
	f, err := fh.Open()
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return contractFailure[apicontract.Null](ret)
	}
	defer f.Close()
	data, err := io.ReadAll(f)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return contractFailure[apicontract.Null](ret)
	}
	password := request.Password
	if err := model.ImportNotebookCryptoBackup(data, password); err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return contractFailure[apicontract.Null](ret)
	}
	return apicontract.Success(apicontract.Null{})
})
