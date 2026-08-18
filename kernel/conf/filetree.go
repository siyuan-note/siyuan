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

import (
	"github.com/siyuan-note/siyuan/kernel/util"
)

type FileTree struct {
	AlwaysSelectOpenedFile   bool   `json:"alwaysSelectOpenedFile"`   // 是否自动选中当前打开的文件
	OpenFilesUseCurrentTab   bool   `json:"openFilesUseCurrentTab"`   // 在当前页签打开文件
	CloseTabOnDoubleClick    bool   `json:"closeTabOnDoubleClick"`    // 是否使用双击关闭页签
	DocIconClickExpand       bool   `json:"docIconClickExpand"`       // 单击文档或笔记本图标时展开或折叠下级文档
	ParentDocClickExpand     bool   `json:"parentDocClickExpand"`     // 单击父文档标题时展开或折叠下级文档
	BoxDocEnabled            *bool  `json:"boxDocEnabled"`            // 是否启用顶层笔记本文档
	RefCreateSaveBox         string `json:"refCreateSaveBox"`         // 块引时新建文档存储笔记本
	RefCreateSavePath        string `json:"refCreateSavePath"`        // 块引时新建文档存储路径
	DocCreateSaveBox         string `json:"docCreateSaveBox"`         // 新建文档存储笔记本
	DocCreateSavePath        string `json:"docCreateSavePath"`        // 新建文档存储路径
	DocCreateTemplatePath    string `json:"docCreateTemplatePath"`    // 新建文档使用的模板路径
	ShorthandSaveBox         string `json:"shorthandSaveBox"`         // 闪念速记存储笔记本
	ShorthandSavePath        string `json:"shorthandSavePath"`        // 闪念速记存储路径
	MaxListCount             int    `json:"maxListCount"`             // 最大列出数量
	MaxOpenTabCount          int    `json:"maxOpenTabCount"`          // 最大打开页签数量
	AllowCreateDeeper        bool   `json:"allowCreateDeeper"`        // 允许创建超过 7 层深度的子文档
	RemoveDocWithoutConfirm  bool   `json:"removeDocWithoutConfirm"`  // 删除文档时是否不需要确认
	CloseTabsOnStart         bool   `json:"closeTabsOnStart"`         // 启动时关闭所有页签
	TabStartupMode           *int   `json:"tabStartupMode"`           // 页签启动策略：0 恢复，1 新建空白页签，2 关闭已打开页签
	UseSingleLineSave        bool   `json:"useSingleLineSave"`        // 使用单行保存文档 .sy 和属性视图 .json
	LargeFileWarningSize     int    `json:"largeFileWarningSize"`     // 大文件警告大小（单位：MB）
	CreateDocAtTop           *bool  `json:"createDocAtTop"`           // 在顶部创建新文档 https://github.com/siyuan-note/siyuan/issues/16327
	Sort                     int    `json:"sort"`                     // 排序方式
	RecentDocsMaxListCount   int    `json:"recentDocsMaxListCount"`   // 最近的文档最大列出数量
	NoSplitScreenWhenOpenTab bool   `json:"noSplitScreenWhenOpenTab"` // 打开页签时不分屏 https://github.com/siyuan-note/siyuan/issues/16833
}

func NewFileTree() *FileTree {
	return &FileTree{
		AlwaysSelectOpenedFile:   false,
		OpenFilesUseCurrentTab:   false,
		CloseTabOnDoubleClick:    false,
		DocIconClickExpand:       false,
		ParentDocClickExpand:     false,
		BoxDocEnabled:            new(bool),
		Sort:                     util.SortModeCustom,
		MaxListCount:             512,
		MaxOpenTabCount:          8,
		AllowCreateDeeper:        false,
		CloseTabsOnStart:         false,
		TabStartupMode:           new(int),
		UseSingleLineSave:        util.UseSingleLineSave,
		LargeFileWarningSize:     util.LargeFileWarningSize,
		CreateDocAtTop:           new(bool),
		NoSplitScreenWhenOpenTab: false,
	}
}

const (
	MinFileTreeRecentDocsListCount = 32
	MaxFileTreeRecentDocsListCount = 256
)
