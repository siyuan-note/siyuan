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
	"github.com/siyuan-note/siyuan/kernel/treenode"
)

// init 把 GetDEKIfUnlocked 注入 filesys 包，让 filesys 的 .sy 读写插点能查询 box 的 DEK。
// 同时把 AV 相关回调注入 av 包，让 AV 定义的笔记本级存储能查询 DEK 和已打开的加密 box。
// filesys / av 不能直接 import model（循环依赖），故通过回调注入。
func init() {
	filesys.DEKProvider = GetDEKIfUnlocked
	av.AVDEKProvider = GetDEKIfUnlocked
	av.AVEncryptedBoxIDs = treenode.GetOpenedEncryptedBoxIDs
	av.AVIsEncryptedBox = IsEncryptedBox
}
