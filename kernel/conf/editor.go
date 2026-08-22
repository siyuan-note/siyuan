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

package conf

import "github.com/siyuan-note/siyuan/kernel/util"

const (
	AssetOpenActionFollowTab  = "follow-tab"
	AssetOpenActionCurrent    = "current"
	AssetOpenActionRight      = "right"
	AssetOpenActionBottom     = "bottom"
	AssetOpenActionBackground = "background"
	AssetOpenActionNewWindow  = "new-window"
	AssetOpenActionApp        = "app"
	AssetOpenActionFolder     = "folder"
)

type AssetOpen struct {
	Click      string `json:"click"`      // 单击资源的打开方式
	CtrlClick  string `json:"ctrlClick"`  // Ctrl 或 Command 加单击资源的打开方式
	AltClick   string `json:"altClick"`   // Alt 加单击资源的打开方式
	ShiftClick string `json:"shiftClick"` // Shift 加单击资源的打开方式
}

// EditorFont 描述编辑器字体及其显示信息。
type EditorFont struct {
	Family      string `json:"family"`
	Weight      int    `json:"weight"`
	DisplayName string `json:"displayName"`
}

type Editor struct {
	AllowSVGScript                  bool           `json:"allowSVGScript"`                  // 允许执行 SVG 内脚本
	AllowHTMLBLockScript            bool           `json:"allowHTMLBLockScript"`            // 允许执行 HTML 内容中的脚本
	FontSize                        int            `json:"fontSize"`                        // 字体大小
	FontSizeScrollZoom              bool           `json:"fontSizeScrollZoom"`              // 字体大小是否支持滚轮缩放
	FontFamily                      string         `json:"fontFamily"`                      // 首选字体（兼容旧版本）
	FontWeight                      int            `json:"fontWeight"`                      // 首选字体字重（兼容旧版本）
	FontFamilyDisplay               string         `json:"fontFamilyDisplay"`               // 设置面板中展示的字体名称（与 FontFamily/FontWeight 对应，可选）
	FontFamilies                    []*EditorFont  `json:"fontFamilies"`                    // 按优先级排列的字体
	CodeSyntaxHighlightLineNum      bool           `json:"codeSyntaxHighlightLineNum"`      // 代码块是否显示行号
	CodeTabSpaces                   int            `json:"codeTabSpaces"`                   // 代码块中 Tab 转换空格数，配置为 0 则表示不转换
	CodeLineWrap                    bool           `json:"codeLineWrap"`                    // 代码块是否自动折行
	CodeLigatures                   bool           `json:"codeLigatures"`                   // 代码块是否连字
	DisplayBookmarkIcon             bool           `json:"displayBookmarkIcon"`             // 是否显示内容块角标
	DisplayNetImgMark               bool           `json:"displayNetImgMark"`               // 是否显示网络图片角标
	DatabaseAttrShow                *bool          `json:"databaseAttrShow"`                // 是否在文档顶部显示数据库属性
	DatabaseAttrClickMode           int            `json:"databaseAttrClickMode"`           // 数据库角标点击模式，0：聚焦块并展开数据库面板，1：打开块属性面板
	DatabaseAttrViewMode            int            `json:"databaseAttrViewMode"`            // 数据库属性默认展开状态，0：展开，1：折叠
	DatabaseAttrHideEmpty           bool           `json:"databaseAttrHideEmpty"`           // 是否隐藏数据库空属性
	DatabaseAttrUseTabs             *bool          `json:"databaseAttrUseTabs"`             // 数据库属性是否使用页签
	GenerateHistoryInterval         int            `json:"generateHistoryInterval"`         // 生成历史时间间隔，单位：分钟
	HistoryRetentionDays            int            `json:"historyRetentionDays"`            // 历史保留天数
	Emoji                           []string       `json:"emoji"`                           // 常用表情
	VirtualBlockRef                 bool           `json:"virtualBlockRef"`                 // 是否启用虚拟引用
	VirtualBlockRefExclude          string         `json:"virtualBlockRefExclude"`          // 虚拟引用关键字排除列表
	VirtualBlockRefInclude          string         `json:"virtualBlockRefInclude"`          // 虚拟引用关键字包含列表
	BlockRefDynamicAnchorTextMaxLen int            `json:"blockRefDynamicAnchorTextMaxLen"` // 块引动态锚文本最大长度
	AssetOpen                       *AssetOpen     `json:"assetOpen"`                       // 资源打开方式
	PlantUMLServePath               string         `json:"plantUMLServePath"`               // PlantUML 伺服地址
	FullWidth                       bool           `json:"fullWidth"`                       // 是否使用最大宽度
	KaTexMacros                     string         `json:"katexMacros"`                     // KeTex 宏定义
	ReadOnly                        bool           `json:"readOnly"`                        // 只读模式
	EmbedBlockBreadcrumb            bool           `json:"embedBlockBreadcrumb"`            // 嵌入块是否显示面包屑
	ListLogicalOutdent              bool           `json:"listLogicalOutdent"`              // 列表逻辑反向缩进
	ListItemDotNumberClickFocus     bool           `json:"listItemDotNumberClickFocus"`     // 单击列表项标记聚焦
	FloatWindowMode                 int            `json:"floatWindowMode"`                 // 浮窗触发模式，0：光标悬停，1：按住 Ctrl 悬停，2：不触发浮窗
	FloatWindowDelay                *int           `json:"floatWindowDelay"`                // 浮窗悬停触发延迟，单位：毫秒，默认 620，nil 表示未设置
	KeepLoadedContent               bool           `json:"keepLoadedContent"`               // 是否保持动态加载的内容
	DynamicLoadBlocks               int            `json:"dynamicLoadBlocks"`               // 块动态数，下限 48
	Justify                         bool           `json:"justify"`                         // 是否两端对齐
	RTL                             bool           `json:"rtl"`                             // 是否从右到左显示
	Spellcheck                      bool           `json:"spellcheck"`                      // 是否启用拼写检查
	SpellcheckLanguages             []string       `json:"spellcheckLanguages"`             // 拼写检查语言
	OnlySearchForDoc                bool           `json:"onlySearchForDoc"`                // 是否启用 [[ 仅搜索文档块
	BacklinkExpandCount             int            `json:"backlinkExpandCount"`             // 反向链接默认展开数量
	BackmentionExpandCount          int            `json:"backmentionExpandCount"`          // 反链提及默认展开数量
	BacklinkMentionExclude          string         `json:"backlinkMentionExclude"`          // 反链提及关键字排除列表
	BacklinkContainChildren         bool           `json:"backlinkContainChildren"`         // 反向链接是否包含子块进行计算
	BacklinkShowBottom              bool           `json:"backlinkShowBottom"`              // 是否在文档底部显示反向链接
	BacklinkSort                    *int           `json:"backlinkSort"`                    // 反向链接排序方式
	BackmentionSort                 *int           `json:"backmentionSort"`                 // 反链提及排序方式
	HeadingNumber                   bool           `json:"headingNumber"`                   // 是否显示标题编号
	HeadingNumberFormat             string         `json:"headingNumberFormat"`             // 标题编号格式
	HeadingEmbedMode                int            `json:"headingEmbedMode"`                // 标题嵌入块模式，0：显示标题与下方的块，1：仅显示标题，2：仅显示标题下方的块
	PasteURLAutoConvert             bool           `json:"pasteURLAutoConvert"`             // 粘贴网址时自动转为链接
	DragHTMLFileToIframe            bool           `json:"dragHTMLFileToIframe"`            // 是否将拖拽的 HTML 文件嵌入为 IFrame 块
	Markdown                        *util.Markdown `json:"markdown"`                        // Markdown 配置
}

// NormalizeFontFamilies 清理字体列表并同步兼容旧版本的首选字体字段。
func (editor *Editor) NormalizeFontFamilies() {
	if nil == editor.FontFamilies && "" != editor.FontFamily {
		editor.FontFamilies = []*EditorFont{{
			Family:      editor.FontFamily,
			Weight:      editor.FontWeight,
			DisplayName: editor.FontFamilyDisplay,
		}}
	}

	fonts := make([]*EditorFont, 0, len(editor.FontFamilies))
	families := map[string]bool{}
	for _, font := range editor.FontFamilies {
		if nil == font || "" == font.Family || families[font.Family] {
			continue
		}
		families[font.Family] = true
		if 1 > font.Weight || 1000 < font.Weight {
			font.Weight = 400
		}
		fonts = append(fonts, font)
	}
	editor.FontFamilies = fonts
	if 0 == len(fonts) {
		editor.FontFamily = ""
		editor.FontWeight = 400
		editor.FontFamilyDisplay = ""
		return
	}

	editor.FontFamily = fonts[0].Family
	editor.FontWeight = fonts[0].Weight
	editor.FontFamilyDisplay = fonts[0].DisplayName
}

const (
	MinDynamicLoadBlocks       = 48
	DefaultHeadingNumberFormat = "decimal-hierarchical"
)

func NormalizeBacklinkExpandCount(count int) int {
	return max(-1, count)
}

func NewAssetOpen() *AssetOpen {
	return &AssetOpen{
		Click:      AssetOpenActionFollowTab,
		CtrlClick:  AssetOpenActionFolder,
		AltClick:   AssetOpenActionCurrent,
		ShiftClick: AssetOpenActionApp,
	}
}

func NormalizeAssetOpen(assetOpen *AssetOpen) *AssetOpen {
	defaults := NewAssetOpen()
	if nil == assetOpen {
		return defaults
	}
	assetOpen.Click = normalizeAssetOpenAction(assetOpen.Click, defaults.Click)
	assetOpen.CtrlClick = normalizeAssetOpenAction(assetOpen.CtrlClick, defaults.CtrlClick)
	assetOpen.AltClick = normalizeAssetOpenAction(assetOpen.AltClick, defaults.AltClick)
	assetOpen.ShiftClick = normalizeAssetOpenAction(assetOpen.ShiftClick, defaults.ShiftClick)
	return assetOpen
}

func normalizeAssetOpenAction(action, fallback string) string {
	switch action {
	case AssetOpenActionFollowTab, AssetOpenActionCurrent, AssetOpenActionRight, AssetOpenActionBottom,
		AssetOpenActionBackground, AssetOpenActionNewWindow, AssetOpenActionApp, AssetOpenActionFolder:
		return action
	default:
		return fallback
	}
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
		DatabaseAttrShow:                new(true),
		DatabaseAttrClickMode:           0,
		DatabaseAttrViewMode:            0,
		DatabaseAttrHideEmpty:           false,
		DatabaseAttrUseTabs:             new(true),
		GenerateHistoryInterval:         10,
		HistoryRetentionDays:            30,
		Emoji:                           []string{},
		VirtualBlockRef:                 false,
		BlockRefDynamicAnchorTextMaxLen: 96,
		AssetOpen:                       NewAssetOpen(),
		PlantUMLServePath:               "https://www.plantuml.com/plantuml/svg/~1",
		FullWidth:                       true,
		KaTexMacros:                     "{}",
		ReadOnly:                        false,
		EmbedBlockBreadcrumb:            false,
		ListLogicalOutdent:              false,
		ListItemDotNumberClickFocus:     true,
		FloatWindowMode:                 0,
		FloatWindowDelay:                new(620),
		KeepLoadedContent:               false,
		DynamicLoadBlocks:               192,
		Justify:                         false,
		RTL:                             false,
		Spellcheck:                      false,
		SpellcheckLanguages:             []string{"en-US"},
		BacklinkExpandCount:             8,
		BackmentionExpandCount:          -1,
		BacklinkContainChildren:         true,
		BacklinkShowBottom:              false,
		BacklinkSort:                    new(util.SortModeUpdatedDESC),
		BackmentionSort:                 new(util.SortModeUpdatedDESC),
		HeadingNumber:                   false,
		HeadingNumberFormat:             DefaultHeadingNumberFormat,
		HeadingEmbedMode:                0,
		PasteURLAutoConvert:             false,
		DragHTMLFileToIframe:            false,
		Markdown:                        util.MarkdownSettings,
	}
}
