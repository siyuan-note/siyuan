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

package tools

// SafeActions 按 action 字符串全局匹配，命中即代表纯只读操作。
// 契约：此处列出的 action 名必须代表纯只读操作。
// 新增工具时，写操作的 action 切勿与此表冲突，否则将静默豁免确认与只读限制。
var SafeActions = map[string]bool{
	"get": true, "get_kramdown": true, "get_children": true, "breadcrumb": true,
	"tree_stat": true, "dom": true, "batch_get": true, "batch_kramdown": true,
	"list": true, "read": true, "search_docs": true, "fulltext": true, "semantic": true, "search": true,
	"backlinks": true, "mentions": true, "refresh": true,
	"labels": true, "status": true, "version": true,
	"current_time": true, "workspace": true, "info": true,
	"grep": true, "find": true, "stat": true, "unused": true,
	"keys": true, "render": true, "diff": true,
	"file_get": true, "file_open": true, "file_export": true,
	"open": true, "close": true, "batch-get": true,
	"md": true, "query": true,
}

// SafeWholeTools 列出整体只读的工具，调用时无需区分 action。
var SafeWholeTools = map[string]bool{
	"question": true, "todo_write": true, "web_fetch": true, "web_search": true,
	"search": true, "sql": true,
}

// SafeToolActions 列出仅部分 action 只读的工具中可安全执行的 action。
var SafeToolActions = map[string]map[string]bool{
	"export": {
		"html": true, "preview": true,
	},
}

// SafeWriteActions 列出 action 名与 SafeActions 冲突但实际会写入的操作。
var SafeWriteActions = map[string]map[string]bool{
	"import": {
		"md": true,
	},
}

// ReadsOnly 判断工具调用是否为纯只读操作，供只读请求限制写入使用。
// 已声明写入效果的工具与 action 一律判为可写，未声明的按只读白名单判断，未知能力按写操作处理。
func (t *Tool) ReadsOnly(action string) bool {
	if t == nil {
		return false
	}
	if SafeWriteActions[t.Name][action] {
		return false
	}
	// 声明了效果的工具以其声明为准，未声明的退回只读白名单。
	if effects, ok := t.EffectsFor(action); ok {
		return !effects.LocalWrite
	}
	if SafeWholeTools[t.Name] {
		return true
	}
	if SafeToolActions[t.Name][action] {
		return true
	}
	return SafeActions[action]
}
