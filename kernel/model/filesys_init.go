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
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// init 把加密相关的回调注入各底层包，让它们能查询 box 的 DEK / 加密状态。
// filesys / av / sql / treenode 不能直接 import model（循环依赖），故通过回调注入。
// sql / treenode 的路由函数据此 fail-closed：加密笔记本未解锁时绝不回退全局库。
func init() {
	filesys.DEKProvider = GetDEKIfUnlocked
	filesys.DEKLockAcquire = HoldBoxReadLock
	filesys.DEKLockRelease = ReleaseBoxReadLock
	av.AVDEKProvider = GetDEKIfUnlocked
	av.AVLockAcquire = HoldBoxReadLock
	av.AVLockRelease = ReleaseBoxReadLock
	av.AVEncryptedBoxIDs = treenode.GetOpenedEncryptedBoxIDs
	av.AVIsEncryptedBox = IsEncryptedBox
	av.AVGetBlockBoxID = func(blockID string) string {
		bt := treenode.GetBlockTree(blockID)
		if nil == bt {
			return ""
		}
		return bt.BoxID
	}
	sql.IsEncryptedBoxFn = IsEncryptedBox
	treenode.IsEncryptedBoxFn = IsEncryptedBox
	util.ReloadDocInfoGuard = func(boxID string) bool {
		// 加密笔记本锁定后丢弃延迟 reloadDocInfo 广播，防止明文元数据泄漏
		if !IsEncryptedBox(boxID) {
			return true
		}
		return IsBoxUnlocked(boxID)
	}
}
