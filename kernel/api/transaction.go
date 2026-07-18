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
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/88250/gulu"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func performTransactions(c *gin.Context) {
	start := time.Now()
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	var trans []any
	var reqID float64
	var app, session string
	if !util.ParseJsonArgs(arg, ret,
		util.BindJsonArg("transactions", &trans, true, true),
		util.BindJsonArg("reqId", &reqID, true, false),
		util.BindJsonArg("app", &app, false, false),
		util.BindJsonArg("session", &session, false, false),
	) {
		return
	}

	if !util.IsBooted() {
		ret.Code = -1
		ret.Msg = fmt.Sprintf(model.Conf.Language(74), int(util.GetBootProgress()))
		ret.Data = map[string]any{"closeTimeout": 5000}
		return
	}

	data, err := gulu.JSON.MarshalJSON(trans)
	if err != nil {
		ret.Code = -1
		ret.Msg = "parses request failed"
		return
	}

	timestamp := int64(reqID)
	var transactions []*model.Transaction
	if err = gulu.JSON.UnmarshalJSON(data, &transactions); err != nil {
		ret.Code = -1
		ret.Msg = "parses request failed"
		return
	}
	for _, transaction := range transactions {
		transaction.Timestamp = timestamp
		transaction.MarkFromAPI() // 标记来自 HTTP 入口，供全局撤销日志捕获判别
	}

	model.PerformTransactions(&transactions)

	ret.Data = transactions

	pushTransactions(app, session, transactions)

	if model.IsMoveOutlineHeading(&transactions) {
		if retData := transactions[0].DoOperations[0].RetData; nil != retData {
			util.PushReloadDoc(retData.(string))
		}
	}

	elapsed := time.Since(start).Milliseconds()
	c.Header("Server-Timing", fmt.Sprintf("total;dur=%d", elapsed))
}

func pushTransactions(app, session string, transactions []*model.Transaction) {
	pushMode := util.PushModeBroadcastExcludeSelf
	if 0 < len(transactions) && 0 < len(transactions[0].DoOperations) {
		model.FlushTxQueue() // 等待文件写入完成，后续渲染才能读取到最新的数据

		if shouldBroadcastAttrViewTransactions(transactions) {
			pushMode = util.PushModeBroadcast
		}
	}

	evt := util.NewCmdResult("transactions", 0, pushMode)
	evt.AppId = app
	evt.SessionId = session
	evt.Data = transactions

	var rootIDs []string
	for _, tx := range transactions {
		rootIDs = append(rootIDs, tx.GetChangedRootIDs()...)
	}
	rootIDs = gulu.Str.RemoveDuplicatedElem(rootIDs)

	for _, tx := range transactions {
		tx.WaitForCommit()
	}

	// 附带每个 rootID 的撤销/重做可用状态，供前端本地镜像同步（多窗口/多端按钮态）
	// 必须在 WaitForCommit 之后读取，确保 Record 已完成，状态含最新条目
	undoStates := map[string]map[string]bool{}
	for _, rootID := range rootIDs {
		canUndo, canRedo, _ := model.GlobalUndoLog.State(rootID)
		undoStates[rootID] = map[string]bool{
			"canUndo": canUndo,
			"canRedo": canRedo,
		}
	}
	evt.Context = map[string]any{
		"rootIDs":   rootIDs,
		"undoState": undoStates,
	}

	util.PushEvent(evt)
}

// undoState 查询指定文档的撤销/重做可用性及栈顶关联的 mutatedRootIDs。
// 前端在打开文档时调用以初始化本地镜像。
func undoState(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	var rootID string
	if !util.ParseJsonArgs(arg, ret,
		util.BindJsonArg("rootID", &rootID, true, false),
	) {
		return
	}

	canUndo, canRedo, peekMutatedRootIDs := model.GlobalUndoLog.State(rootID)
	ret.Data = map[string]any{
		"canUndo":            canUndo,
		"canRedo":            canRedo,
		"peekMutatedRootIDs": peekMutatedRootIDs,
	}
}

// performUndo 撤销指定文档最近一次操作。
// 弹出 rootID 撤销栈顶，同步执行其逆操作，广播给其它窗口/端。
// 单文档撤销：发起窗口靠响应数据本地乐观应用，广播排除发起方（ExcludeSelf）。
// 跨文档撤销：发起窗口无法本地乐观应用（锚点分散），广播含发起方（Broadcast）刷新其 DOM。
// 逆操作失败时回滚栈状态（UndoRollback）并返回 data.failed=true，前端镜像不动。
func performUndo(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	var rootID, app, session string
	if !util.ParseJsonArgs(arg, ret,
		util.BindJsonArg("rootID", &rootID, true, false),
		util.BindJsonArg("app", &app, false, false),
		util.BindJsonArg("session", &session, false, false),
	) {
		return
	}

	entry := model.GlobalUndoLog.Undo(rootID)
	if nil == entry {
		// 栈空，无可撤销
		ret.Data = map[string]any{
			"canUndo": false,
			"canRedo": false,
		}
		return
	}

	tx := &model.Transaction{
		Timestamp:      time.Now().UnixMilli(),
		DoOperations:   entry.UndoOperationsForReplay(),
		UndoOperations: entry.DoOperationsForReplay(),
	}
	tx.MarkReplay()
	// 重放前解决剪切后粘贴造成的块 ID 冲突（已存在的 ID 换新，避免重复）
	model.ResolveReplayDuplicateIds(tx)

	if err := model.PerformTxSync(tx); nil != err {
		// 逆操作执行失败，回滚执行栈。返回 code=0 + data.failed=true（而非 code=-1），
		// 否则前端 processMessage 拦截导致 fetchPost 回调不执行、isUndoing 永不复位。
		model.GlobalUndoLog.UndoRollback(entry, rootID)
		ret.Data = map[string]any{
			"failed": true,
			"msg":    "undo failed: " + err.Error(),
		}
		return
	}

	// 成功：联动从其它关联栈移除该 entry
	model.GlobalUndoLog.UndoCommit(entry, rootID)

	crossDoc := len(entry.MutatedRootIDs()) > 1
	pushUndoTransactions(app, session, []*model.Transaction{tx}, true, crossDoc)

	canUndo, canRedo, _ := model.GlobalUndoLog.State(rootID)
	// 返回重放后（已解决 ID 冲突）的 tx 操作，前端乐观应用与 kernel 落盘一致
	ret.Data = map[string]any{
		"doOperations":   tx.DoOperations,
		"undoOperations": tx.UndoOperations,
		"mutatedRootIDs": entry.MutatedRootIDs(),
		"canUndo":        canUndo,
		"canRedo":        canRedo,
		"isUndo":         true,
	}
}

// performRedo 重做指定文档最近一次撤销的操作。
func performRedo(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	var rootID, app, session string
	if !util.ParseJsonArgs(arg, ret,
		util.BindJsonArg("rootID", &rootID, true, false),
		util.BindJsonArg("app", &app, false, false),
		util.BindJsonArg("session", &session, false, false),
	) {
		return
	}

	entry := model.GlobalUndoLog.Redo(rootID)
	if nil == entry {
		ret.Data = map[string]any{
			"canUndo": false,
			"canRedo": false,
		}
		return
	}

	tx := &model.Transaction{
		Timestamp:      time.Now().UnixMilli(),
		DoOperations:   entry.DoOperationsForReplay(),
		UndoOperations: entry.UndoOperationsForReplay(),
	}
	tx.MarkReplay()
	// 重放前解决剪切后粘贴造成的块 ID 冲突（已存在的 ID 换新，避免重复）
	model.ResolveReplayDuplicateIds(tx)

	if err := model.PerformTxSync(tx); nil != err {
		// 重做失败，回滚执行栈。返回 code=0 + data.failed=true（避免前端 isUndoing 死锁）。
		model.GlobalUndoLog.RedoRollback(entry, rootID)
		ret.Data = map[string]any{
			"failed": true,
			"msg":    "redo failed: " + err.Error(),
		}
		return
	}

	// 成功：联动把 entry 重新挂到其它关联栈
	model.GlobalUndoLog.RedoCommit(entry, rootID)

	crossDoc := len(entry.MutatedRootIDs()) > 1
	pushUndoTransactions(app, session, []*model.Transaction{tx}, true, crossDoc)

	canUndo, canRedo, _ := model.GlobalUndoLog.State(rootID)
	// 返回重放后（已解决 ID 冲突）的 tx 操作，前端乐观应用与 kernel 落盘一致
	ret.Data = map[string]any{
		"doOperations":   tx.DoOperations,
		"undoOperations": tx.UndoOperations,
		"mutatedRootIDs": entry.MutatedRootIDs(),
		"canUndo":        canUndo,
		"canRedo":        canRedo,
		"isUndo":         false,
	}
}

// clearHistory 清理撤销日志。rootID 非空时清该文档栈并联动移除其它栈相关条目；为空时清空全部。
func clearHistory(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	var rootID string
	if !util.ParseJsonArgs(arg, ret, util.BindJsonArg("rootID", &rootID, false, false)) {
		return
	}

	model.GlobalUndoLog.Clear(rootID)
}

// pushUndoTransactions 广播 undo/redo 重放事务。
// isReplay=true 时 context 标记 isUndoReplay（前端据此重置 lastHTMLs）。
// includeSelf=true 时用 PushModeBroadcast（含发起方），用于跨文档撤销/重做——
// 此时 undoOperations 锚点分散在多个文档，发起方无法本地乐观应用，需靠广播刷新自身 DOM；
// includeSelf=false 时用 PushModeBroadcastExcludeSelf，发起方靠响应数据本地乐观应用。
func pushUndoTransactions(app, session string, transactions []*model.Transaction, isReplay, includeSelf bool) {
	pushMode := util.PushModeBroadcastExcludeSelf
	if includeSelf {
		pushMode = util.PushModeBroadcast
	}
	if !includeSelf && 0 < len(transactions) && 0 < len(transactions[0].DoOperations) {
		if shouldBroadcastAttrViewTransactions(transactions) {
			pushMode = util.PushModeBroadcast
		}
	}

	evt := util.NewCmdResult("transactions", 0, pushMode)
	evt.AppId = app
	evt.SessionId = session
	evt.Data = transactions

	var rootIDs []string
	for _, tx := range transactions {
		rootIDs = append(rootIDs, tx.GetChangedRootIDs()...)
	}
	rootIDs = gulu.Str.RemoveDuplicatedElem(rootIDs)

	undoStates := map[string]map[string]bool{}
	for _, rootID := range rootIDs {
		canUndo, canRedo, _ := model.GlobalUndoLog.State(rootID)
		undoStates[rootID] = map[string]bool{
			"canUndo": canUndo,
			"canRedo": canRedo,
		}
	}
	evt.Context = map[string]any{
		"rootIDs":      rootIDs,
		"undoState":    undoStates,
		"isUndoReplay": isReplay,
	}

	for _, tx := range transactions {
		tx.WaitForCommit()
	}
	util.PushEvent(evt)
}

func shouldBroadcastAttrViewTransactions(transactions []*model.Transaction) bool {
	for _, tx := range transactions {
		for _, operation := range tx.DoOperations {
			if nil != operation && "setAttrViewName" != operation.Action && strings.Contains(strings.ToLower(operation.Action), "attrview") {
				return true
			}
		}
	}
	return false
}
