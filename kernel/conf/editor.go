// SiYuan - Build Your Eternal Digital Garden
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

type Editor struct {
	FontSize                        int      `json:"fontSize"`
	FontFamily                      string   `json:"fontFamily"`
	CodeSyntaxHighlightLineNum      bool     `json:"codeSyntaxHighlightLineNum"`
	CodeTabSpaces                   int      `json:"codeTabSpaces"` // 代码块中 Tab 转换空格数，配置为 0 则表示不转换
	CodeLineWrap                    bool     `json:"codeLineWrap"`  // 代码块是否自动折行
	CodeLigatures                   bool     `json:"codeLigatures"` // 代码块是否连字
	DisplayBookmarkIcon             bool     `json:"displayBookmarkIcon"`
	DisplayNetImgMark               bool     `json:"displayNetImgMark"`
	GenerateHistoryInterval         int      `json:"generateHistoryInterval"`         // 生成历史时间间隔，单位：分钟
	HistoryRetentionDays            int      `json:"historyRetentionDays"`            // 历史保留天数
	Emoji                           []string `json:"emoji"`                           // 常用表情
	VirtualBlockRef                 bool     `json:"virtualBlockRef"`                 // 是否启用虚拟引用
	VirtualBlockRefExclude          string   `json:"virtualBlockRefExclude"`          // 虚拟引用关键字排除列表
	BlockRefDynamicAnchorTextMaxLen int      `json:"blockRefDynamicAnchorTextMaxLen"` // 块引动态锚文本最大长度
	PlantUMLServePath               string   `json:"plantUMLServePath"`               // PlantUML 伺服地址
}

func NewEditor() *Editor {
	return &Editor{
		FontSize:                        16,
		CodeSyntaxHighlightLineNum:      true,
		CodeTabSpaces:                   0,
		CodeLineWrap:                    false,
		CodeLigatures:                   false,
		DisplayBookmarkIcon:             true,
		DisplayNetImgMark:               true,
		GenerateHistoryInterval:         10,
		HistoryRetentionDays:            30,
		Emoji:                           []string{},
		VirtualBlockRef:                 false,
		BlockRefDynamicAnchorTextMaxLen: 64,
		PlantUMLServePath:               "https://www.plantuml.com/plantuml/svg/~1",
	}
}
