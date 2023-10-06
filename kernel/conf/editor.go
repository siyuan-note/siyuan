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

type Editor struct {
	FontSize                        int      `json:"fontSize"`                        // 字体大小
	FontSizeScrollZoom              bool     `json:"fontSizeScrollZoom"`              // 字体大小是否支持滚轮缩放
	FontFamily                      string   `json:"fontFamily"`                      // 字体
	CodeSyntaxHighlightLineNum      bool     `json:"codeSyntaxHighlightLineNum"`      // 代码块是否显示行号
	CodeTabSpaces                   int      `json:"codeTabSpaces"`                   // 代码块中 Tab 转换空格数，配置为 0 则表示不转换
	CodeLineWrap                    bool     `json:"codeLineWrap"`                    // 代码块是否自动折行
	CodeLigatures                   bool     `json:"codeLigatures"`                   // 代码块是否连字
	DisplayBookmarkIcon             bool     `json:"displayBookmarkIcon"`             // 是否显示书签图标
	DisplayNetImgMark               bool     `json:"displayNetImgMark"`               // 是否显示网络图片角标
	GenerateHistoryInterval         int      `json:"generateHistoryInterval"`         // 生成历史时间间隔，单位：分钟
	HistoryRetentionDays            int      `json:"historyRetentionDays"`            // 历史保留天数
	Emoji                           []string `json:"emoji"`                           // 常用表情
	VirtualBlockRef                 bool     `json:"virtualBlockRef"`                 // 是否启用虚拟引用
	VirtualBlockRefExclude          string   `json:"virtualBlockRefExclude"`          // 虚拟引用关键字排除列表
	VirtualBlockRefInclude          string   `json:"virtualBlockRefInclude"`          // 虚拟引用关键字包含列表
	BlockRefDynamicAnchorTextMaxLen int      `json:"blockRefDynamicAnchorTextMaxLen"` // 块引动态锚文本最大长度
	PlantUMLServePath               string   `json:"plantUMLServePath"`               // PlantUML 伺服地址
	FullWidth                       bool     `json:"fullWidth"`                       // 是否使用最大宽度
	KaTexMacros                     string   `json:"katexMacros"`                     // KeTex 宏定义
	ReadOnly                        bool     `json:"readOnly"`                        // 只读模式
	EmbedBlockBreadcrumb            bool     `json:"embedBlockBreadcrumb"`            // 嵌入块是否显示面包屑
	ListLogicalOutdent              bool     `json:"listLogicalOutdent"`              // 列表逻辑反向缩进
	FloatWindowMode                 int      `json:"floatWindowMode"`                 // 浮窗触发模式，0：光标悬停，1：按住 Ctrl 悬停
	DynamicLoadBlocks               int      `json:"dynamicLoadBlocks"`               // 块动态数，可配置区间 [48, 1024]
	Justify                         bool     `json:"justify"`                         // 是否两端对齐
	RTL                             bool     `json:"rtl"`                             // 是否从右到左显示
	Spellcheck                      bool     `json:"spellcheck"`                      // 是否启用拼写检查
	OnlySearchForDoc                bool     `json:"onlySearchForDoc"`                // 是否启用 [[ 仅搜索文档块
	BacklinkExpandCount             int      `json:"backlinkExpandCount"`             // 反向链接默认展开数量
	BackmentionExpandCount          int      `json:"backmentionExpandCount"`          // 反链提及默认展开数量
}

func NewEditor() *Editor {
	return &Editor{
		FontSize:                        16,
		FontSizeScrollZoom:              false,
		CodeSyntaxHighlightLineNum:      false,
		CodeTabSpaces:                   0,
		CodeLineWrap:                    false,
		CodeLigatures:                   false,
		DisplayBookmarkIcon:             true,
		DisplayNetImgMark:               true,
		GenerateHistoryInterval:         10,
		HistoryRetentionDays:            30,
		Emoji:                           []string{},
		VirtualBlockRef:                 false,
		BlockRefDynamicAnchorTextMaxLen: 96,
		PlantUMLServePath:               "https://www.plantuml.com/plantuml/svg/~1",
		FullWidth:                       true,
		KaTexMacros:                     "{}",
		ReadOnly:                        false,
		EmbedBlockBreadcrumb:            false,
		ListLogicalOutdent:              false,
		FloatWindowMode:                 0,
		DynamicLoadBlocks:               128,
		Justify:                         false,
		RTL:                             false,
		BacklinkExpandCount:             8,
		BackmentionExpandCount:          8,
	}
}
