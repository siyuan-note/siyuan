// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package apicontract

// AVNestedRequest 显式声明树形读取能力；省略时保留平铺返回。
// childPaging 使用 parentID，分组内使用 groupID/parentID；页码从 1 开始，页大小最大 200。
// 子条目仅返回请求页；定位自动切换根和各祖先的子项页，index/offset 对应可见行序列。
// rootCount 按投影后的根计数，matchedCount 仅统计实际匹配项，不计祖先上下文。
type AVNestedRequest struct {
	ExpandedIDs      []string                  `json:"expandedIDs" api:"optional,nullable"`
	GroupExpandedIDs map[string][]string       `json:"groupExpandedIDs" api:"optional,nullable"`
	ChildPaging      map[string]*AVGroupPaging `json:"childPaging" api:"optional,nullable"`
}

type AVNestedResult struct {
	Page         int                           `json:"page"`
	PageSize     int                           `json:"pageSize"`
	RootCount    int                           `json:"rootCount"`
	RootLoaded   int                           `json:"rootLoaded"`
	MatchedCount int                           `json:"matchedCount"`
	ChildPaging  map[string]*AVNestedChildPage `json:"childPaging"`
}

type AVNestedChildPage struct {
	Page     int `json:"page"`
	PageSize int `json:"pageSize"`
	Total    int `json:"total"`
	Loaded   int `json:"loaded"`
}

type AVItemHierarchy struct {
	ParentID   string `json:"parentID,omitempty"`
	Depth      int    `json:"depth"`
	ChildCount int    `json:"childCount"`
	Context    bool   `json:"context"`
	Expanded   bool   `json:"expanded"`
}

type AVSubItemsConfig struct {
	Enabled       bool   `json:"enabled"`
	ParentKeyID   string `json:"parentKeyID"`
	ChildrenKeyID string `json:"childrenKeyID"`
}
