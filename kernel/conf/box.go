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

package conf

import "github.com/siyuan-note/siyuan/kernel/util"

// BoxConf 维护 .siyuan/conf.json 笔记本配置。
type BoxConf struct {
	Name                  string `json:"name"`                  // 笔记本名称
	Sort                  int    `json:"sort"`                  // 排序字段
	Icon                  string `json:"icon"`                  // 图标
	Closed                bool   `json:"closed"`                // 是否处于关闭状态
	RefCreateSavePath     string `json:"refCreateSavePath"`     // 块引时新建文档存储路径
	DocCreateSavePath     string `json:"docCreateSavePath"`     // 新建文档存储路径
	DailyNoteSavePath     string `json:"dailyNoteSavePath"`     // 新建日记存储路径
	DailyNoteTemplatePath string `json:"dailyNoteTemplatePath"` // 新建日记使用的模板路径
	SortMode              int    `json:"sortMode"`              // 排序方式
}

func NewBoxConf() *BoxConf {
	return &BoxConf{
		Name:                  "Untitled",
		Closed:                true,
		DailyNoteSavePath:     "/daily note/{{now | date \"2006/01\"}}/{{now | date \"2006-01-02\"}}",
		DailyNoteTemplatePath: "",
		SortMode:              util.SortModeFileTree,
	}
}
