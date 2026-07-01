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
	"fmt"
	"regexp"
	"sync"
	"sync/atomic"
	"time"

	"github.com/88250/gulu"
	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/treenode"
)

// UndoEntry 是撤销栈中的一条记录。跨文档操作（MutatedRootIDs 含多个 rootID）的 entry
// 会以同一指针同时挂在这些 rootID 的栈上，撤销任一端时联动其它端移除引用。
type UndoEntry struct {
	id             string
	doOperations   []*Operation
	undoOperations []*Operation
	timestamp      int64
	mutatedRootIDs []string // 真正被写盘修改的树 rootID，联动与跨文档判定用
}

// DoOperationsForReplay 返回正向操作副本，供 redo 重放构造事务。
func (e *UndoEntry) DoOperationsForReplay() []*Operation {
	return cloneOperations(e.doOperations)
}

// UndoOperationsForReplay 返回逆向操作副本，供 undo 重放构造事务。
func (e *UndoEntry) UndoOperationsForReplay() []*Operation {
	return cloneOperations(e.undoOperations)
}

// MutatedRootIDs 返回该条目影响的 rootID 列表副本。
func (e *UndoEntry) MutatedRootIDs() []string {
	if nil == e.mutatedRootIDs {
		return nil
	}
	ret := make([]string, len(e.mutatedRootIDs))
	copy(ret, e.mutatedRootIDs)
	return ret
}

// undoStack 是单个 rootID 的撤销/重做栈。
type undoStack struct {
	undoStack []*UndoEntry
	redoStack []*UndoEntry
	hasUndo   bool // 复现前端 hasUndo 状态机：undo 后置 true，add 时若 true 则清 redo
}

// UndoLog 是全局撤销日志，按 rootID 分栈，所有窗口/客户端共享同一权威。
type UndoLog struct {
	mu     sync.Mutex
	stacks map[string]*undoStack
	max    int
}

// GlobalUndoLog 全局撤销日志单例。内存态，重启清空。
var GlobalUndoLog = newUndoLog(64)

var undoEntrySeq uint64

func newUndoLog(max int) *UndoLog {
	return &UndoLog{
		stacks: map[string]*undoStack{},
		max:    max,
	}
}

func newUndoEntryID() string {
	seq := atomic.AddUint64(&undoEntrySeq, 1)
	return fmt.Sprintf("undo-%d-%d", time.Now().UnixNano(), seq)
}

// stack 返回 rootID 对应的栈，不存在则返回 nil。
func (l *UndoLog) stack(rootID string) *undoStack {
	return l.stacks[rootID]
}

// stackOrCreate 返回 rootID 对应的栈，不存在则新建。
func (l *UndoLog) stackOrCreate(rootID string) *undoStack {
	s := l.stacks[rootID]
	if nil == s {
		s = &undoStack{}
		l.stacks[rootID] = s
	}
	return s
}

// Record 记录一笔已提交的编辑器事务。仅当事务来自 /api/transactions（fromAPI）、
// 携带非空 UndoOperations、且非 undo/redo 重放（isReplay）时记录。
func (l *UndoLog) Record(tx *Transaction) {
	if !tx.fromAPI || 0 == len(tx.UndoOperations) || tx.isReplay {
		return
	}

	rootIDs := tx.GetMutatedRootIDs()
	if 0 == len(rootIDs) {
		// 纯属性视图单元格编辑等不写 block tree 的事务不入栈
		return
	}

	l.mu.Lock()
	defer l.mu.Unlock()

	entry := &UndoEntry{
		id:             newUndoEntryID(),
		doOperations:   cloneOperations(tx.DoOperations),
		undoOperations: cloneOperations(tx.UndoOperations),
		timestamp:      time.Now().UnixMilli(),
		mutatedRootIDs: rootIDs,
	}

	for _, rootID := range rootIDs {
		s := l.stackOrCreate(rootID)
		s.undoStack = append(s.undoStack, entry)
		if s.hasUndo {
			s.redoStack = nil
			s.hasUndo = false
		}
		if l.max < len(s.undoStack) {
			s.undoStack = s.undoStack[len(s.undoStack)-l.max:]
		}
	}
}

// Peek 返回 rootID 撤销栈顶（不弹出），栈空返回 nil。
func (l *UndoLog) Peek(rootID string) *UndoEntry {
	l.mu.Lock()
	defer l.mu.Unlock()

	s := l.stack(rootID)
	if nil == s || 0 == len(s.undoStack) {
		return nil
	}
	return s.undoStack[len(s.undoStack)-1]
}

// Undo 弹出 rootID 撤销栈顶，压入执行栈重做栈，置 hasUndo。仅动执行栈，不做联动移除。
// 成功执行逆操作后调 UndoCommit 完成联动；失败调 UndoRollback 精确回滚（因只动了执行栈）。
// 返回弹出的 entry；栈空返回 nil。
func (l *UndoLog) Undo(rootID string) *UndoEntry {
	l.mu.Lock()
	defer l.mu.Unlock()

	s := l.stack(rootID)
	if nil == s || 0 == len(s.undoStack) {
		return nil
	}

	entry := s.undoStack[len(s.undoStack)-1]
	s.undoStack = s.undoStack[:len(s.undoStack)-1]
	// 只压入执行撤销的栈，符合语义 B：在 B 按 Ctrl+Y 不重做这条
	s.redoStack = append(s.redoStack, entry)
	if l.max < len(s.redoStack) {
		s.redoStack = s.redoStack[len(s.redoStack)-l.max:]
	}
	s.hasUndo = true
	return entry
}

// UndoCommit 在逆操作成功执行后，联动从其它关联栈移除该 entry（按 id 匹配）。
func (l *UndoLog) UndoCommit(entry *UndoEntry, rootID string) {
	if nil == entry {
		return
	}
	l.mu.Lock()
	defer l.mu.Unlock()

	for _, r := range entry.mutatedRootIDs {
		if r == rootID {
			continue
		}
		l.removeEntry(r, entry.id)
	}
}

// UndoRollback 在逆操作执行失败时回滚执行栈：把 entry 从重做栈移回撤销栈顶，复位 hasUndo。
// 因 Undo 只动了执行栈，此回滚精确无误。
func (l *UndoLog) UndoRollback(entry *UndoEntry, rootID string) {
	if nil == entry {
		return
	}
	l.mu.Lock()
	defer l.mu.Unlock()

	s := l.stack(rootID)
	if nil == s {
		return
	}
	// 从执行栈重做栈顶移除 entry（Undo 压入的）
	if 0 < len(s.redoStack) && s.redoStack[len(s.redoStack)-1].id == entry.id {
		s.redoStack = s.redoStack[:len(s.redoStack)-1]
	}
	// 推回执行栈撤销栈顶（恢复 Undo 弹出前的位置）
	s.undoStack = append(s.undoStack, entry)
	s.hasUndo = false
}

// Redo 弹出 rootID 重做栈顶，压回执行栈撤销栈。仅动执行栈，不做联动重挂。
// 不改 hasUndo（复现前端 redo 的不对称）。成功后调 RedoCommit；失败调 RedoRollback。
func (l *UndoLog) Redo(rootID string) *UndoEntry {
	l.mu.Lock()
	defer l.mu.Unlock()

	s := l.stack(rootID)
	if nil == s || 0 == len(s.redoStack) {
		return nil
	}

	entry := s.redoStack[len(s.redoStack)-1]
	s.redoStack = s.redoStack[:len(s.redoStack)-1]
	s.undoStack = append(s.undoStack, entry)
	return entry
}

// RedoCommit 在重做成功执行后，联动把 entry 重新挂到其它关联栈顶。
func (l *UndoLog) RedoCommit(entry *UndoEntry, rootID string) {
	if nil == entry {
		return
	}
	l.mu.Lock()
	defer l.mu.Unlock()

	for _, r := range entry.mutatedRootIDs {
		if r == rootID {
			continue
		}
		rs := l.stackOrCreate(r)
		rs.undoStack = append(rs.undoStack, entry)
		if l.max < len(rs.undoStack) {
			rs.undoStack = rs.undoStack[len(rs.undoStack)-l.max:]
		}
	}
}

// RedoRollback 在重做执行失败时回滚执行栈：把 entry 从撤销栈移回重做栈顶。
// 因 Redo 只动了执行栈，此回滚精确无误。
func (l *UndoLog) RedoRollback(entry *UndoEntry, rootID string) {
	if nil == entry {
		return
	}
	l.mu.Lock()
	defer l.mu.Unlock()

	s := l.stack(rootID)
	if nil == s {
		return
	}
	// 从执行栈撤销栈顶移除 entry（Redo 压入的）
	if 0 < len(s.undoStack) && s.undoStack[len(s.undoStack)-1].id == entry.id {
		s.undoStack = s.undoStack[:len(s.undoStack)-1]
	}
	// 推回执行栈重做栈顶
	s.redoStack = append(s.redoStack, entry)
	if l.max < len(s.redoStack) {
		s.redoStack = s.redoStack[len(s.redoStack)-l.max:]
	}
}

// State 返回 rootID 的撤销/重做可用性及栈顶关联的 mutatedRootIDs。
func (l *UndoLog) State(rootID string) (canUndo, canRedo bool, peekMutatedRootIDs []string) {
	l.mu.Lock()
	defer l.mu.Unlock()

	s := l.stack(rootID)
	if nil == s {
		return
	}
	canUndo = 0 < len(s.undoStack)
	canRedo = 0 < len(s.redoStack)
	if canUndo {
		top := s.undoStack[len(s.undoStack)-1]
		peekMutatedRootIDs = append(peekMutatedRootIDs, top.mutatedRootIDs...)
		peekMutatedRootIDs = gulu.Str.RemoveDuplicatedElem(peekMutatedRootIDs)
	}
	return
}

// Clear 清理撤销日志。rootID 非空时清该文档栈并联动移除其它栈中相关条目；为空时清空全部。
func (l *UndoLog) Clear(rootID string) {
	l.mu.Lock()
	defer l.mu.Unlock()

	if "" == rootID {
		l.stacks = map[string]*undoStack{}
		return
	}

	s := l.stacks[rootID]
	if nil == s {
		return
	}
	// 收集该栈中所有跨文档条目的 id，联动从其它栈移除
	linkedIDs := map[string]bool{}
	for _, e := range s.undoStack {
		for _, r := range e.mutatedRootIDs {
			if r != rootID {
				linkedIDs[e.id] = true
			}
		}
	}
	for _, e := range s.redoStack {
		for _, r := range e.mutatedRootIDs {
			if r != rootID {
				linkedIDs[e.id] = true
			}
		}
	}
	delete(l.stacks, rootID)
	for otherID, other := range l.stacks {
		for id := range linkedIDs {
			other.undoStack = removeEntryByID(other.undoStack, id)
			other.redoStack = removeEntryByID(other.redoStack, id)
		}
		_ = otherID
	}
}

// removeEntry 从 rootID 栈中按 id 移除一条 entry（撤销联动用）。
func (l *UndoLog) removeEntry(rootID, id string) {
	s := l.stacks[rootID]
	if nil == s {
		return
	}
	s.undoStack = removeEntryByID(s.undoStack, id)
}

func removeEntryByID(stack []*UndoEntry, id string) []*UndoEntry {
	for i, e := range stack {
		if e.id == id {
			return append(stack[:i], stack[i+1:]...)
		}
	}
	return stack
}

// cloneOperations 深拷贝操作切片（值拷贝每个 Operation），使日志条目与后续事务解耦。
// performTx 的 doInsert0 等会原地改写 operation.ID/Action 等标量字段，若浅拷贝指针会导致
// 已记录的条目被改写、redo 重放时 ID 失效。值拷贝复制标量字段，Data(any) 共享引用（performTx 不改其内容）。
func cloneOperations(ops []*Operation) []*Operation {
	if nil == ops {
		return nil
	}
	ret := make([]*Operation, len(ops))
	for i, op := range ops {
		cloned := *op // 值拷贝标量字段（ID/Action/ParentID/PreviousID/NextID/AvID 等）
		ret[i] = &cloned
	}
	return ret
}

var dataNodeIDPattern = regexp.MustCompile(`data-node-id="([^"]+)"`)
var refcountAttrPattern = regexp.MustCompile(`\s*refcount="[^"]*"`)
var refcountDivPattern = regexp.MustCompile(`<div class="protyle-attr--refcount[^"]*"[^>]*>.*?</div>`)

// ResolveReplayDuplicateIds 在 undo/redo 重放事务前解决块 ID 冲突。
// 场景：剪切块 X 后粘贴到别处（保留原 ID），再撤销剪切会 insert X，而 X 已存在于粘贴处，产生重复 ID。
// 这里对即将重放的 insert 操作做检查——若其引入的 ID 在块树中已存在，则在正反向操作及关联字段
// （ID/ParentID/PreviousID/NextID 与 Data 内联 ID）上统一替换为新 ID。
// 替换同时作用于 do/undo 两套操作：重放只执行 doOperations，但若不同步改 undoOperations，
// 随后对同一 entry 的 redo 会沿用旧 ID 再次撞库。
func ResolveReplayDuplicateIds(tx *Transaction) {
	if nil == tx || !tx.isReplay {
		return
	}

	// 收集所有 insert 操作引入的块 ID（op.ID + Data 内联的 data-node-id）
	ids := map[string]struct{}{}
	collect := func(ops []*Operation) {
		for _, op := range ops {
			if "insert" != op.Action {
				continue
			}
			if "" != op.ID && ast.IsNodeIDPattern(op.ID) {
				ids[op.ID] = struct{}{}
			}
			data, ok := op.Data.(string)
			if !ok {
				continue
			}
			for _, m := range dataNodeIDPattern.FindAllStringSubmatch(data, -1) {
				if ast.IsNodeIDPattern(m[1]) {
					ids[m[1]] = struct{}{}
				}
			}
		}
	}
	collect(tx.DoOperations)
	// 注意：只检测 DoOperations（实际执行的操作），不检测 UndoOperations。
	// UndoOperations 在 redo 时会作为新的 DoOperations 再次过 ResolveReplayDuplicateIds。
	// 若 undo 时也检测 UndoOperations 的 insert，会把 redo 用的 ID 换新，
	// 污染 DoOperations 的对应 delete（do/undo 共享 replacements），导致撤销删除错误 ID。
	if 0 == len(ids) {
		return
	}

	idList := make([]string, 0, len(ids))
	for id := range ids {
		idList = append(idList, id)
	}
	exist := treenode.ExistBlockTrees(idList)

	// 已存在的 ID 生成替换
	replacements := map[string]string{}
	for _, id := range idList {
		if exist[id] {
			replacements[id] = ast.NewNodeID()
		}
	}
	if 0 == len(replacements) {
		return
	}

	// 对 do/undo 两套操作统一替换 ID 及关联字段
	apply := func(ops []*Operation) {
		for _, op := range ops {
			// 记录本操作的 ID 是否被换新（在改 op.ID 之前判断，否则 replacements 的 key 是 oldID 查不到）
			_, idReplaced := replacements[op.ID]
			// 仅 insert 操作替换 op.ID。delete 操作声明的 ID 是待删除的旧块本身，若换为新 ID，
			// doDelete 会找不到节点而静默跳过，导致旧块残留并在重放后产生重复块。
			// 典型场景：列表转段落后撤销——undo 先 delete 扁平化出的子块，再 insert 原列表
			// （HTML 内联同一批子块 ID），这些子块会被前置 delete 清理，本不该参与冲突替换。
			// https://github.com/siyuan-note/siyuan/issues/18012
			if "insert" == op.Action {
				if newID, ok := replacements[op.ID]; ok {
					op.ID = newID
				}
			}
			if newID, ok := replacements[op.ParentID]; ok {
				op.ParentID = newID
			}
			if newID, ok := replacements[op.PreviousID]; ok {
				op.PreviousID = newID
			}
			if newID, ok := replacements[op.NextID]; ok {
				op.NextID = newID
			}
			data, ok := op.Data.(string)
			if !ok {
				continue
			}
			for oldID, newID := range replacements {
				data = dataNodeIDPattern.ReplaceAllStringFunc(data, func(match string) string {
					if sub := dataNodeIDPattern.FindStringSubmatch(match); len(sub) > 1 && sub[1] == oldID {
						return `data-node-id="` + newID + `"`
					}
					return match
				})
			}
			// ID 被换新的块（剪切粘贴后撤销恢复的副本）清除引用角标，避免显示旧的 refcount。
			// 角标由 kernel 异步刷新（refreshRefCount）重建为正确值。
			if idReplaced {
				data = refcountDivPattern.ReplaceAllString(data, "")
				data = refcountAttrPattern.ReplaceAllString(data, "")
			}
			op.Data = data
		}
	}
	apply(tx.DoOperations)
}
