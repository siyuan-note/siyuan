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

package av

// BaseLayout 描述了布局的基础结构，包含通用的过滤、排序和分页信息。
type BaseLayout struct {
	Spec     int           `json:"spec"`     // 布局格式版本
	ID       string        `json:"id"`       // 布局 ID
	Filters  []*ViewFilter `json:"filters"`  // 过滤规则
	Sorts    []*ViewSort   `json:"sorts"`    // 排序规则
	PageSize int           `json:"pageSize"` // 每页行数
}
