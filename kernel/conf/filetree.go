// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package conf

import (
	"github.com/siyuan-note/siyuan/kernel/util"
)

type FileTree struct {
	RecentDocsSort             string `json:"recentDocsSort"`             // 最近文档排序方式
	AlwaysSelectOpenedFile     bool   `json:"alwaysSelectOpenedFile"`     // 是否自动选中当前打开的文件
	OpenFilesUseCurrentTab     bool   `json:"openFilesUseCurrentTab"`     // 在当前页签打开文件
	CloseTabOnDoubleClick      bool   `json:"closeTabOnDoubleClick"`      // 是否使用双击关闭页签
	CloseWindowOnLastTabClosed *bool  `json:"closeWindowOnLastTabClosed"` // 关闭或移走最后一个页签后关闭独立窗口
	DocIconClickMode           int    `json:"docIconClickMode"`           // 单击文档图标或笔记本图标的行为：0 修改图标，1 展开或折叠子文档
	ParentDocTitleClickMode    int    `json:"parentDocTitleClickMode"`    // 点击父文档标题的行为：0 打开文档，1 展开或折叠子文档，2 单击展开或折叠子文档、双击打开父文档
	BoxDocEnabled              bool   `json:"boxDocEnabled"`              // 是否启用顶层笔记本文档
	UseSVGDefaultIcon          bool   `json:"useSVGDefaultIcon"`          // 是否使用 SVG 默认图标
	RefCreateSaveBox           string `json:"refCreateSaveBox"`           // 块引时新建文档存储笔记本
	RefCreateSavePath          string `json:"refCreateSavePath"`          // 块引时新建文档存储路径
	DocCreateSaveBox           string `json:"docCreateSaveBox"`           // 新建文档存储笔记本
	DocCreateSavePath          string `json:"docCreateSavePath"`          // 新建文档存储路径
	DocCreateTemplatePath      string `json:"docCreateTemplatePath"`      // 新建文档使用的模板路径
	ShorthandSaveBox           string `json:"shorthandSaveBox"`           // 闪念速记存储笔记本
	ShorthandSavePath          string `json:"shorthandSavePath"`          // 闪念速记存储路径
	MaxListCount               int    `json:"maxListCount"`               // 最大列出数量
	MaxOpenTabCount            int    `json:"maxOpenTabCount"`            // 最大打开页签数量
	AllowCreateDeeper          bool   `json:"allowCreateDeeper"`          // 允许创建超过 7 层深度的子文档
	RemoveDocWithoutConfirm    bool   `json:"removeDocWithoutConfirm"`    // 删除文档时是否不需要确认
	CloseTabsOnStart           bool   `json:"closeTabsOnStart"`           // 启动时关闭所有页签
	TabStartupMode             *int   `json:"tabStartupMode"`             // 页签启动策略：0 恢复，1 新建空白页签，2 关闭已打开页签
	UseSingleLineSave          bool   `json:"useSingleLineSave"`          // 使用单行保存文档 .sy 和属性视图 .json
	LargeFileWarningSize       int    `json:"largeFileWarningSize"`       // 大文件警告大小（单位：MB）
	CreateDocAtTop             *bool  `json:"createDocAtTop"`             // 在顶部创建新文档 https://github.com/siyuan-note/siyuan/issues/16327
	Sort                       int    `json:"sort"`                       // 排序方式
	RecentDocsMaxListCount     int    `json:"recentDocsMaxListCount"`     // 最近的文档最大列出数量
	NoSplitScreenWhenOpenTab   bool   `json:"noSplitScreenWhenOpenTab"`   // 打开页签时不分屏 https://github.com/siyuan-note/siyuan/issues/16833
}

func NewFileTree() *FileTree {
	return &FileTree{
		RecentDocsSort:             "viewedAt",
		AlwaysSelectOpenedFile:     false,
		OpenFilesUseCurrentTab:     false,
		CloseTabOnDoubleClick:      false,
		CloseWindowOnLastTabClosed: new(true),
		DocIconClickMode:           0,
		ParentDocTitleClickMode:    0,
		BoxDocEnabled:              false,
		UseSVGDefaultIcon:          true,
		Sort:                       util.SortModeCustom,
		MaxListCount:               512,
		MaxOpenTabCount:            8,
		AllowCreateDeeper:          false,
		CloseTabsOnStart:           false,
		TabStartupMode:             new(int),
		UseSingleLineSave:          util.DefaultUseSingleLineSave,
		LargeFileWarningSize:       util.DefaultLargeFileWarningSize,
		CreateDocAtTop:             new(bool),
		NoSplitScreenWhenOpenTab:   false,
	}
}

const (
	MinFileTreeRecentDocsListCount = 32
	MaxFileTreeRecentDocsListCount = 256
)
