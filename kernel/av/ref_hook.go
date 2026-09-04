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

package av

import "github.com/siyuan-note/logging"

// AttributeViewSaved 由 model 层注入，在属性视图落盘后刷新载体文档的引用索引。
var AttributeViewSaved func(avID, boxID string)

// NotifyAttributeViewSaved 安全地通知上层属性视图已经落盘。
func NotifyAttributeViewSaved(avID, boxID string) {
	if nil == AttributeViewSaved {
		return
	}
	defer func() {
		if recovered := recover(); nil != recovered {
			logging.LogErrorf("notify saved attribute view [%s] failed: %v", avID, recovered)
		}
	}()
	AttributeViewSaved(avID, boxID)
}
