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
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/88250/gulu"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var performTransactions = contractHandler(apicontract.PerformTransactions, func(c *gin.Context, request apicontract.PerformTransactionsRequest) apicontract.Response[[]*apicontract.Transaction] {
	start := time.Now()
	if !util.IsBooted() {
		return apicontract.FailureWithTimeout[[]*apicontract.Transaction](-1, fmt.Sprintf(model.Conf.Language(74), int(util.GetBootProgress())), 5000)
	}

	if request.DecodeError != nil {
		return apicontract.Failure[[]*apicontract.Transaction](-1, "parses request failed")
	}
	var transactions []*model.Transaction
	if err := gulu.JSON.UnmarshalJSON(request.TransactionJSON, &transactions); err != nil {
		return apicontract.Failure[[]*apicontract.Transaction](-1, "parses request failed")
	}
	timestamp := int64(request.ReqID)
	var err error

	if err = model.ValidateFlashcardTransactions(transactions); err != nil {
		return apicontract.Failure[[]*apicontract.Transaction](-1, err.Error())
	}
	if err = holdTransactionEncryptedBoxRequests(c, transactions); err != nil {
		return apicontract.Failure[[]*apicontract.Transaction](-1, model.Conf.Language(314))
	}
	for _, transaction := range transactions {
		if nil != transaction && "" != transaction.TemplateDocTreePlanID {
			model.FlushTxQueue()
			break
		}
	}
	templateDocTreeAttached, err := model.AttachTemplateDocTreePlans(transactions)
	if nil != err {
		return apicontract.Failure[[]*apicontract.Transaction](-1, util.EscapeHTML(err.Error()))
	}
	for _, transaction := range transactions {
		transaction.Timestamp = timestamp
		transaction.MarkFromAPI() // 标记来自 HTTP 入口，供全局撤销日志捕获判别
	}

	if templateDocTreeAttached {
		if err = model.PerformTxSync(transactions[0]); nil != err {
			return apicontract.Failure[[]*apicontract.Transaction](-1, util.EscapeHTML(err.Error()))
		}
	} else {
		model.PerformTransactions(&transactions)
	}

	pushTransactions(request.App, request.Session, transactions)

	if model.IsMoveOutlineHeading(&transactions) {
		if retData := transactions[0].DoOperations[0].RetData; nil != retData {
			util.PushReloadDoc(retData.(string))
		}
	}

	elapsed := time.Since(start).Milliseconds()
	c.Header("Server-Timing", fmt.Sprintf("total;dur=%d", elapsed))
	result, err := transactionContracts(transactions)
	if err != nil {
		return apicontract.Failure[[]*apicontract.Transaction](-1, err.Error())
	}
	return apicontract.Success(result)
})

func holdTransactionEncryptedBoxRequests(c *gin.Context, transactions []*model.Transaction) error {
	boxIDs := map[string]struct{}{}
	addBoxID := func(boxID string) {
		if boxID != "" && model.IsEncryptedBox(boxID) {
			boxIDs[boxID] = struct{}{}
		}
	}
	addBlockID := func(blockID string) {
		if blockID == "" {
			return
		}
		block := treenode.GetBlockTree(blockID)
		if nil == block {
			for _, encryptedBoxID := range treenode.GetOpenedEncryptedBoxIDs() {
				if block = treenode.GetBlockTreeInBox(blockID, encryptedBoxID); nil != block {
					break
				}
			}
		}
		if nil != block {
			addBoxID(block.BoxID)
			return
		}
		addBoxID(blockID)
	}
	for _, transaction := range transactions {
		for _, operation := range transaction.DoOperations {
			if operation == nil {
				continue
			}
			for _, id := range []string{
				operation.ID, operation.RootID, operation.ParentID, operation.PreviousID, operation.NextID, operation.BlockID,
			} {
				addBlockID(id)
			}
			for _, id := range operation.BlockIDs {
				addBlockID(id)
			}
			for _, id := range operation.SrcIDs {
				addBlockID(id)
			}
			for _, src := range operation.Srcs {
				if id, ok := src["id"].(string); ok {
					addBlockID(id)
				}
			}
			if operation.Tree != nil {
				addBoxID(operation.Tree.Box)
			}
			if _, boxID := av.FindAttributeViewPath(operation.AvID); boxID != "" {
				addBoxID(boxID)
			}
			for _, key := range []string{"notebook", "box", "boxID", "rootID", "blockID"} {
				if id, ok := operation.Context[key].(string); ok {
					addBlockID(id)
				}
			}
		}
	}

	sortedBoxIDs := make([]string, 0, len(boxIDs))
	for boxID := range boxIDs {
		sortedBoxIDs = append(sortedBoxIDs, boxID)
	}
	sort.Strings(sortedBoxIDs)
	for _, boxID := range sortedBoxIDs {
		if err := holdEncryptedBoxRequest(c, boxID); err != nil {
			return err
		}
	}
	return nil
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
var undoState = contractHandler(apicontract.UndoState, func(c *gin.Context, request apicontract.TransactionUndoStateRequest) apicontract.Response[apicontract.TransactionUndoState] {
	canUndo, canRedo, peekMutatedRootIDs := model.GlobalUndoLog.State(request.RootID)
	if model.IsReadOnlyRole(model.GetGinContextRole(c)) {
		peekMutatedRootIDs = []string{}
	}
	return apicontract.Success(apicontract.TransactionUndoState{CanUndo: canUndo, CanRedo: canRedo, PeekMutatedRootIDs: peekMutatedRootIDs})
})

// performUndo 撤销指定文档最近一次操作。
// 弹出 rootID 撤销栈顶，同步执行其逆操作，广播给其它窗口/端。
// 单文档撤销：发起窗口靠响应数据本地乐观应用，广播排除发起方（ExcludeSelf）。
// 跨文档撤销：发起窗口无法本地乐观应用（锚点分散），广播含发起方（Broadcast）刷新其 DOM。
// 逆操作失败时回滚栈状态（UndoRollback）并返回 data.failed=true，前端镜像不动。
var performUndo = contractHandler(apicontract.PerformUndo, func(c *gin.Context, request apicontract.TransactionHistoryRequest) apicontract.Response[apicontract.TransactionHistoryResult] {
	entry := model.GlobalUndoLog.Undo(request.RootID)
	if nil == entry {
		// 栈空，无可撤销
		return apicontract.Success(apicontract.EmptyTransactionHistory())
	}

	tx := &model.Transaction{
		Timestamp:      time.Now().UnixMilli(),
		DoOperations:   entry.UndoOperationsForReplay(),
		UndoOperations: entry.DoOperationsForReplay(),
	}
	if err := holdBlockSwapReplayRequests(c, tx, entry.MutatedRootIDs()); err != nil {
		model.GlobalUndoLog.UndoRollback(entry, request.RootID)
		return apicontract.Success(apicontract.FailedTransactionHistory("undo failed: " + err.Error()))
	}
	tx.MarkReplay()
	// 重放前解决剪切后粘贴造成的块 ID 冲突（已存在的 ID 换新，避免重复）
	model.ResolveReplayDuplicateIds(tx)

	if err := model.PerformTxSync(tx); nil != err {
		// 逆操作执行失败，回滚执行栈。返回 code=0 + data.failed=true（而非 code=-1），
		// 否则前端 processMessage 拦截导致 fetchPost 回调不执行、isUndoing 永不复位。
		model.GlobalUndoLog.UndoRollback(entry, request.RootID)
		return apicontract.Success(apicontract.FailedTransactionHistory("undo failed: " + err.Error()))
	}

	// 成功：联动从其它关联栈移除该 entry
	model.GlobalUndoLog.UndoCommit(entry, request.RootID)

	crossDoc := len(entry.MutatedRootIDs()) > 1
	pushUndoTransactions(request.App, request.Session, []*model.Transaction{tx}, true, crossDoc)

	canUndo, canRedo, _ := model.GlobalUndoLog.State(request.RootID)
	// 返回重放后（已解决 ID 冲突）的 tx 操作，前端乐观应用与 kernel 落盘一致
	operations, err := transactionOperationContracts(tx.DoOperations)
	if err != nil {
		return apicontract.Failure[apicontract.TransactionHistoryResult](-1, err.Error())
	}
	undoOperations, err := transactionOperationContracts(tx.UndoOperations)
	if err != nil {
		return apicontract.Failure[apicontract.TransactionHistoryResult](-1, err.Error())
	}
	return apicontract.Success(apicontract.AppliedTransactionHistory(apicontract.TransactionHistoryApplied{
		DoOperations: operations, UndoOperations: undoOperations, MutatedRootIDs: entry.MutatedRootIDs(), CanUndo: canUndo, CanRedo: canRedo, IsUndo: true,
	}))
})

// performRedo 重做指定文档最近一次撤销的操作。
var performRedo = contractHandler(apicontract.PerformRedo, func(c *gin.Context, request apicontract.TransactionHistoryRequest) apicontract.Response[apicontract.TransactionHistoryResult] {
	entry := model.GlobalUndoLog.Redo(request.RootID)
	if nil == entry {
		return apicontract.Success(apicontract.EmptyTransactionHistory())
	}

	tx := &model.Transaction{
		Timestamp:      time.Now().UnixMilli(),
		DoOperations:   entry.DoOperationsForReplay(),
		UndoOperations: entry.UndoOperationsForReplay(),
	}
	if err := holdBlockSwapReplayRequests(c, tx, entry.MutatedRootIDs()); err != nil {
		model.GlobalUndoLog.RedoRollback(entry, request.RootID)
		return apicontract.Success(apicontract.FailedTransactionHistory("redo failed: " + err.Error()))
	}
	tx.MarkReplay()
	// 重放前解决剪切后粘贴造成的块 ID 冲突（已存在的 ID 换新，避免重复）
	model.ResolveReplayDuplicateIds(tx)

	if err := model.PerformTxSync(tx); nil != err {
		// 重做失败，回滚执行栈。返回 code=0 + data.failed=true（避免前端 isUndoing 死锁）。
		model.GlobalUndoLog.RedoRollback(entry, request.RootID)
		return apicontract.Success(apicontract.FailedTransactionHistory("redo failed: " + err.Error()))
	}

	// 成功：联动把 entry 重新挂到其它关联栈
	model.GlobalUndoLog.RedoCommit(entry, request.RootID)

	crossDoc := len(entry.MutatedRootIDs()) > 1
	pushUndoTransactions(request.App, request.Session, []*model.Transaction{tx}, true, crossDoc)

	canUndo, canRedo, _ := model.GlobalUndoLog.State(request.RootID)
	// 返回重放后（已解决 ID 冲突）的 tx 操作，前端乐观应用与 kernel 落盘一致
	operations, err := transactionOperationContracts(tx.DoOperations)
	if err != nil {
		return apicontract.Failure[apicontract.TransactionHistoryResult](-1, err.Error())
	}
	undoOperations, err := transactionOperationContracts(tx.UndoOperations)
	if err != nil {
		return apicontract.Failure[apicontract.TransactionHistoryResult](-1, err.Error())
	}
	return apicontract.Success(apicontract.AppliedTransactionHistory(apicontract.TransactionHistoryApplied{
		DoOperations: operations, UndoOperations: undoOperations, MutatedRootIDs: entry.MutatedRootIDs(), CanUndo: canUndo, CanRedo: canRedo, IsUndo: false,
	}))
})

// clearHistory 清理撤销日志。rootID 非空时清该文档栈并联动移除其它栈相关条目；为空时清空全部。
var clearHistory = contractHandler(apicontract.ClearHistory, func(c *gin.Context, request apicontract.TransactionClearHistoryRequest) apicontract.Response[apicontract.Null] {
	model.GlobalUndoLog.Clear(request.RootID)
	return apicontract.Success(apicontract.Null{})
})

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

func holdBlockSwapReplayRequests(c *gin.Context, tx *model.Transaction, rootIDs []string) error {
	for _, operation := range tx.DoOperations {
		if operation != nil && operation.Action == "swapBlockRef" {
			return holdEncryptedBlockRequests(c, "", rootIDs, false)
		}
	}
	return nil
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

// transactionContracts 在提交及推送完成后读取最终操作，保留模型更新的内容和返回数据。
func transactionContracts(values []*model.Transaction) (result []*apicontract.Transaction, err error) {
	data, err := json.Marshal(values)
	if err != nil {
		return nil, err
	}
	err = json.Unmarshal(data, &result)
	return result, err
}

func transactionOperationContracts(values []*model.Operation) (result []*apicontract.TransactionOperation, err error) {
	data, err := json.Marshal(values)
	if err != nil {
		return nil, err
	}
	err = json.Unmarshal(data, &result)
	return result, err
}
