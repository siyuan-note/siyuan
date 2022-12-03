// SiYuan - Build Your Eternal Digital Garden
// Copyright (c) 2020-present, b3log.org
//
// This program is free software you can redistribute it and/or modify
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

type Criterion struct {
	Name        string          `json:"name"`
	Sort        int             `json:"sort"`       //  0：按块类型（默认），1：按创建时间升序，2：按创建时间降序，3：按更新时间升序，4：按更新时间降序，5：按内容顺序（仅在按文档分组时）
	Group       int             `json:"group"`      // 0：不分组，1：按文档分组
	Layout      int             `json:"layout"`     // 0：上下，1：左右
	HasReplace  bool            `json:"hasReplace"` // 是否有替换
	Method      int             `json:"method"`     //  0：文本，1：查询语法，2：SQL，3：正则表达式
	HPath       string          `json:"hPath"`
	IDPath      []string        `json:"idPath"`
	K           string          `json:"k"`           // 搜索关键字
	R           string          `json:"r"`           // 替换关键字
	ReplaceList []string        `json:"replaceList"` // 替换候选列表
	List        []string        `json:"list"`        // 搜索候选列表
	Types       *CriterionTypes `json:"types"`       // 类型过滤选项
}

type CriterionTypes struct {
	MathBlock  bool `json:"mathBlock"`
	Table      bool `json:"table"`
	Blockquote bool `json:"blockquote"`
	SuperBlock bool `json:"superBlock"`
	Paragraph  bool `json:"paragraph"`
	Document   bool `json:"document"`
	Heading    bool `json:"heading"`
	List       bool `json:"list"`
	ListItem   bool `json:"listItem"`
	CodeBlock  bool `json:"codeBlock"`
	HtmlBlock  bool `json:"htmlBlock"`
}
