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

package api

import (
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/88250/gulu"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func getNotebookInfo(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	var boxID string
	if !util.ParseJsonArgs(arg, ret, util.BindJsonArg("notebook", &boxID, true, true)) {
		return
	}
	if util.InvalidIDPattern(boxID, ret) {
		return
	}

	box := model.Conf.Box(boxID)
	if nil == box {
		ret.Code = -1
		ret.Msg = "notebook [" + boxID + "] not found"
		return
	}
	if model.IsReadOnlyRoleContext(c) && !isNotebookVisibleByPublishAccess(box, model.GetPublishAccess()) {
		ret.Code = -1
		ret.Msg = "notebook [" + boxID + "] not found"
		return
	}
	if err := holdEncryptedBoxRequest(c, boxID); err != nil {
		ret.Code = -1
		ret.Msg = model.Conf.Language(314)
		return
	}

	boxInfo := box.GetInfo()
	ret.Data = map[string]any{
		"boxInfo": boxInfo,
	}
}

func setNotebookIcon(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	var boxID, icon string
	if !util.ParseJsonArgs(arg, ret,
		util.BindJsonArg("notebook", &boxID, true, true),
		util.BindJsonArg("icon", &icon, true, false),
	) {
		return
	}
	if err := holdEncryptedBoxRequest(c, boxID); err != nil {
		ret.Code = -1
		ret.Msg = model.Conf.Language(314)
		return
	}
	model.SetBoxIcon(boxID, icon)
}

func changeSortNotebook(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	idsArg := arg["notebooks"].([]any)
	var ids []string
	for _, p := range idsArg {
		ids = append(ids, p.(string))
	}
	for _, id := range ids {
		if err := holdEncryptedBoxRequest(c, id); err != nil {
			ret.Code = -1
			ret.Msg = model.Conf.Language(314)
			return
		}
	}
	model.ChangeBoxSort(ids)
}

func renameNotebook(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	var notebook, name string
	if !util.ParseJsonArgs(arg, ret,
		util.BindJsonArg("notebook", &notebook, true, true),
		util.BindJsonArg("name", &name, true, false),
	) {
		return
	}
	if util.InvalidIDPattern(notebook, ret) {
		return
	}
	if err := holdEncryptedBoxRequest(c, notebook); err != nil {
		ret.Code = -1
		ret.Msg = model.Conf.Language(314)
		return
	}
	err := model.RenameBox(notebook, name)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		ret.Data = map[string]any{"closeTimeout": 5000}
		return
	}

	evt := util.NewCmdResult("renamenotebook", 0, util.PushModeBroadcast)
	evt.Data = map[string]any{
		"box":  notebook,
		"name": name,
	}
	util.PushEvent(evt)
}

func removeNotebook(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	var notebook string
	if !util.ParseJsonArgs(arg, ret, util.BindJsonArg("notebook", &notebook, true, true)) {
		return
	}
	if util.InvalidIDPattern(notebook, ret) {
		return
	}

	if util.ReadOnly && !model.IsUserGuide(notebook) {
		ret.Code = -1
		ret.Msg = model.Conf.Language(34)
		ret.Data = map[string]any{"closeTimeout": 5000}
		return
	}

	err := model.RemoveBox(notebook)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	evt := util.NewCmdResult("removeBox", 0, util.PushModeBroadcast)
	evt.Data = map[string]any{
		"box": notebook,
	}
	util.PushEvent(evt)
	model.TriggerOnboardingIfEmpty()
}

func createNotebook(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	var name string
	if !util.ParseJsonArgs(arg, ret, util.BindJsonArg("name", &name, true, false)) {
		return
	}
	id, err := model.CreateBox(name)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	existed, err := model.Mount(id)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	box := model.Conf.Box(id)
	if nil == box {
		ret.Code = -1
		ret.Msg = "opened notebook [" + id + "] not found"
		return
	}

	ret.Data = map[string]any{
		"notebook": box,
	}

	evt := util.NewCmdResult("createnotebook", 0, util.PushModeBroadcast)
	evt.Data = map[string]any{
		"box":     box,
		"existed": existed,
	}
	util.PushEvent(evt)
}

func openNotebook(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	var notebook string
	if !util.ParseJsonArgs(arg, ret, util.BindJsonArg("notebook", &notebook, true, true)) {
		return
	}
	if util.InvalidIDPattern(notebook, ret) {
		return
	}

	isUserGuide := model.IsUserGuide(notebook)
	if util.ReadOnly && !isUserGuide {
		ret.Code = -1
		ret.Msg = model.Conf.Language(34)
		ret.Data = map[string]any{"closeTimeout": 5000}
		return
	}
	if err := holdEncryptedBoxRequest(c, notebook); err != nil {
		ret.Code = -1
		ret.Msg = model.Conf.Language(314)
		return
	}

	msgId := util.PushMsg(model.Conf.Language(45), 1000*60*15)
	defer util.PushClearMsg(msgId)
	existed, err := model.Mount(notebook)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	box := model.Conf.Box(notebook)
	if nil == box {
		ret.Code = -1
		ret.Msg = "opened notebook [" + notebook + "] not found"
		return
	}

	evt := util.NewCmdResult("mount", 0, util.PushModeBroadcast)
	evt.Data = map[string]any{
		"box":     box,
		"existed": existed,
	}
	util.PushEvent(evt)

	if isUserGuide {
		appArg := arg["app"]
		app := ""
		if nil != appArg {
			app = appArg.(string)
		}

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
}

func closeNotebook(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	notebook := arg["notebook"].(string)
	if util.InvalidIDPattern(notebook, ret) {
		return
	}
	model.Unmount(notebook)
}

func getNotebookConf(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	notebook := arg["notebook"].(string)
	if util.InvalidIDPattern(notebook, ret) {
		return
	}

	box := model.Conf.GetBox(notebook)
	if nil == box {
		ret.Code = -1
		ret.Msg = "notebook [" + notebook + "] not found"
		return
	}
	if model.IsReadOnlyRoleContext(c) && !isNotebookVisibleByPublishAccess(box, model.GetPublishAccess()) {
		ret.Code = -1
		ret.Msg = "notebook [" + notebook + "] not found"
		return
	}
	if model.IsBoxUnlocked(notebook) {
		if err := holdEncryptedBoxRequest(c, notebook); err != nil {
			ret.Code = -1
			ret.Msg = model.Conf.Language(314)
			return
		}
	}

	boxConf := box.GetConf()
	if !model.IsAdminRoleContext(c) {
		model.HideBoxConfSecret(boxConf)
	}
	ret.Data = map[string]any{
		"box":  box.ID,
		"name": box.Name,
		"conf": boxConf,
	}
}

func setNotebookConf(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	notebook := arg["notebook"].(string)
	if util.InvalidIDPattern(notebook, ret) {
		return
	}

	box := model.Conf.GetBox(notebook)
	if nil == box {
		ret.Code = -1
		ret.Msg = "notebook [" + notebook + "] not found"
		return
	}
	if model.IsBoxUnlocked(notebook) {
		if err := holdEncryptedBoxRequest(c, notebook); err != nil {
			ret.Code = -1
			ret.Msg = model.Conf.Language(314)
			return
		}
	}

	param, err := gulu.JSON.MarshalJSON(arg["conf"])
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	boxConf := box.GetConf()
	// 深拷贝加密相关字段，防止反序列化请求体时被覆盖
	// BoxCrypt 是指针，UnmarshalJSON 会修改同一指针对象，必须用 model 层辅助函数深拷贝
	savedBoxCrypt := model.DeepCopyBoxEncryption(boxConf.BoxCrypt)
	savedEncrypted := boxConf.Encrypted
	if err = gulu.JSON.UnmarshalJSON(param, boxConf); err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
	boxConf.Encrypted = savedEncrypted
	boxConf.BoxCrypt = savedBoxCrypt

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
		return
	}

	boxConf.DailyNoteTemplatePath = util.NormalizeTemplatePath(boxConf.DailyNoteTemplatePath)

	if err := box.SaveConf(boxConf); err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
	ret.Data = boxConf
}

func lsNotebooks(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	flashcard := false

	// 兼容旧版接口，不能直接使用 util.JsonArg()
	arg := map[string]any{}
	if err := c.ShouldBindJSON(&arg); err == nil {
		if arg["flashcard"] != nil {
			flashcard = arg["flashcard"].(bool)
		}
	}

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
				return
			}
		}
		var err error
		notebooks, err = model.ListNotebooks()
		if err != nil {
			return
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
	}

	ret.Data = map[string]any{
		"notebooks":     notebooks,
		"boxDocEnabled": boxDocEnabled,
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
func enableEncryptedNotebooks(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	var password string
	if !util.ParseJsonArgs(arg, ret, util.BindJsonArg("password", &password, true, true)) {
		return
	}

	if err := model.EnableEncryptedNotebookWithSync(password); err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
}

// disableEncryptedNotebooks 关闭加密笔记本功能。前置：没有加密笔记本存在。
func disableEncryptedNotebooks(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	if err := model.DisableEncryptedNotebook(); err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
}

// createEncryptedNotebook 创建一个新的加密笔记本。前置：加密功能已启用。
// 创建时需提供主密码（用于派生 KEK 包络 DEK）。创建成功后内核已原子完成挂载。
func createEncryptedNotebook(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	var name, password string
	if !util.ParseJsonArgs(arg, ret,
		util.BindJsonArg("name", &name, true, false),
		util.BindJsonArg("password", &password, true, true),
	) {
		return
	}

	id, err := model.CreateEncryptedBox(name, password)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
	if err = holdEncryptedBoxRequest(c, id); err != nil {
		ret.Code = -1
		ret.Msg = model.Conf.Language(314)
		return
	}

	// 创建时 DEK 已缓存 + 加密 db 已打开，此处直接挂载；失败则锁定回滚，避免 DEK 残留
	existed, err := model.Mount(id)
	if err != nil {
		releaseEncryptedBoxRequest(c, id)
		model.LockBox(id)
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	box := model.Conf.Box(id)
	evt := util.NewCmdResult("mount", 0, util.PushModeBroadcast)
	evt.Data = map[string]any{
		"box":     box,
		"existed": existed,
	}
	util.PushEvent(evt)

	ret.Data = map[string]any{
		"notebook": box,
	}
}

// unlockNotebook 用主密码派生 KEK 并解出指定加密笔记本的 DEK，缓存到内存。
// 解锁后该笔记本即可被 Mount。每次调用跑一次 Argon2id（约 1 秒）。
func unlockNotebook(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	var notebook, password string
	if !util.ParseJsonArgs(arg, ret,
		util.BindJsonArg("notebook", &notebook, true, true),
		util.BindJsonArg("password", &password, true, true),
	) {
		return
	}

	if util.InvalidIDPattern(notebook, ret) {
		return
	}

	boxCrypt, err := model.GetBoxEncryption(notebook)
	if err != nil {
		ret.Code = -1
		ret.Msg = model.Conf.Language(318)
		return
	}
	if boxCrypt == nil || len(boxCrypt.WrappedDEK) == 0 {
		ret.Code = -1
		ret.Msg = model.Conf.Language(319)
		return
	}

	if err := model.UnlockBox(notebook, password, boxCrypt); err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
	if err = holdEncryptedBoxRequest(c, notebook); err != nil {
		ret.Code = -1
		ret.Msg = model.Conf.Language(314)
		return
	}
}

// unlockAndOpenNotebook 原子化解锁并挂载加密笔记本，挂载失败时由模型层在同一转换锁内回滚本次解锁。
func unlockAndOpenNotebook(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	var notebook, password string
	if !util.ParseJsonArgs(arg, ret,
		util.BindJsonArg("notebook", &notebook, true, true),
		util.BindJsonArg("password", &password, true, true),
	) {
		return
	}

	if util.InvalidIDPattern(notebook, ret) {
		return
	}

	boxCrypt, err := model.GetBoxEncryption(notebook)
	if err != nil {
		ret.Code = -1
		ret.Msg = model.Conf.Language(318)
		return
	}
	if boxCrypt == nil || len(boxCrypt.WrappedDEK) == 0 {
		ret.Code = -1
		ret.Msg = model.Conf.Language(319)
		return
	}

	msgId := util.PushMsg(model.Conf.Language(45), 1000*60*15)
	defer util.PushClearMsg(msgId)
	existed, err := model.UnlockAndMountBox(notebook, password, boxCrypt)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
	if err = holdEncryptedBoxRequest(c, notebook); err != nil {
		ret.Code = -1
		ret.Msg = model.Conf.Language(314)
		return
	}

	box := model.Conf.Box(notebook)
	if nil == box {
		releaseEncryptedBoxRequest(c, notebook)
		model.LockBox(notebook)
		ret.Code = -1
		ret.Msg = "opened notebook [" + notebook + "] not found"
		return
	}

	evt := util.NewCmdResult("mount", 0, util.PushModeBroadcast)
	evt.Data = map[string]any{
		"box":     box,
		"existed": existed,
	}
	util.PushEvent(evt)
}

// lockNotebook 锁定指定加密笔记本：清除其 DEK 缓存并 Unmount。
func lockNotebook(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	var notebook string
	if !util.ParseJsonArgs(arg, ret, util.BindJsonArg("notebook", &notebook, true, true)) {
		return
	}

	if util.InvalidIDPattern(notebook, ret) {
		return
	}

	if !model.IsEncryptedBox(notebook) {
		ret.Code = -1
		ret.Msg = model.Conf.Language(319)
		return
	}

	// Unmount 内部的 unmount0 会清 DEK + 关闭加密 db，无需单独 LockBox。
	// 反过来若先 LockBox 会关闭 db，导致 Unmount 的 Unindex 操作无 db 可用。
	model.Unmount(notebook)
}

// setNotebookCryptoAutoLock 设置加密笔记本自动锁定闲置分钟数。
func setNotebookCryptoAutoLock(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	var autoLockMinutes float64
	if !util.ParseJsonArgs(arg, ret, util.BindJsonArg("autoLockMinutes", &autoLockMinutes, true, false)) {
		return
	}

	minutes := max(int(autoLockMinutes), 0)

	model.SetAutoLockMinutes(minutes)
	model.Conf.Save()
}

// touchEncryptedNotebooks 由前端真实用户交互或 headless 客户端显式保活调用，刷新已解锁加密笔记本的闲置计时。
func touchEncryptedNotebooks(c *gin.Context) {
	model.TouchUnlockedEncryptedBoxes()
	c.JSON(http.StatusOK, gulu.Ret.NewResult())
}

// changeMasterPassword 修改加密笔记本的主密码。
// 用旧密码校验后，用新密码派生新 KEK，重新加密 verifier 和所有加密笔记本的 WrappedDEK。
// 必须在所有加密笔记本都已锁定（DEK 不在内存）的状态下调用。
func changeMasterPassword(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	var oldPassword, newPassword string
	if !util.ParseJsonArgs(arg, ret,
		util.BindJsonArg("oldPassword", &oldPassword, true, true),
		util.BindJsonArg("newPassword", &newPassword, true, true),
	) {
		return
	}

	if err := model.ChangeMasterPassword(oldPassword, newPassword); err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
}

// getEncryptedNotebookStatus 返回加密笔记本功能的启用状态和各笔记本解锁信息。
func getEncryptedNotebookStatus(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	model.NotebookCryptoMuLock()
	boxIDs := model.ListAllEncryptedBoxIDs()
	model.NotebookCryptoMuUnlock()
	pendingMigration, migrationBoxes := model.MasterPasswordMigrationStatus()
	// 历史目录中是否存在已删除加密笔记本的历史快照：其恢复依赖当前密钥备份，
	// 存在时前端禁用入口应拦截（与 DisableEncryptedNotebook 的后端检查对齐）
	hasHistoryDependency := model.HasEncryptedNotebookHistory()
	state := model.NotebookCryptoLifecycleState(len(boxIDs) > 0 || hasHistoryDependency)

	boxes := make([]map[string]any, 0, len(boxIDs))
	for _, id := range boxIDs {
		box := model.Conf.Box(id)
		name := ""
		if box != nil {
			name = box.Name
		}
		boxes = append(boxes, map[string]any{
			"id":       id,
			"name":     name,
			"unlocked": model.IsBoxUnlocked(id),
			"state":    model.GetEncryptedBoxState(id),
		})
	}

	ret.Data = map[string]any{
		"enabled":              state == model.NotebookCryptoStateEnabled,
		"state":                state,
		"count":                len(boxIDs),
		"boxes":                boxes,
		"migrationPending":     pendingMigration,
		"migrationBoxes":       migrationBoxes,
		"hasHistoryDependency": hasHistoryDependency,
	}
}

// exportNotebookCryptoBackup 导出密钥备份文件到 export 目录供下载。
// 备份文件不含主密码（salt 不保密、verifier 是密文），用户主动保存作为同步之外的独立恢复途径。
func exportNotebookCryptoBackup(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	downloadPath, err := model.ExportNotebookCryptoBackup()
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
	ret.Data = map[string]any{
		"file": downloadPath,
	}
}

// importNotebookCryptoBackup 导入密钥备份文件，恢复加密配置。
// 用于新设备、重装或 RecoveryRequired 状态下手动恢复；完整且已启用的配置拒绝覆盖。
func importNotebookCryptoBackup(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	form, err := c.MultipartForm()
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
	if 1 > len(form.File["file"]) {
		ret.Code = -1
		ret.Msg = "file not found"
		return
	}
	fh := form.File["file"][0]
	f, err := fh.Open()
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
	defer f.Close()
	data, err := io.ReadAll(f)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
	password := ""
	if vals := form.Value["password"]; len(vals) > 0 {
		password = vals[0]
	}
	if err := model.ImportNotebookCryptoBackup(data, password); err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
}
