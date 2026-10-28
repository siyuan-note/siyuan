// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package apicontract

type BlockTreeInfo struct {
	// HeadingChildren 仅对标题返回，表示完整文档同一容器内是否存在下辖块；空段落也算下辖块。
	// 此字段不受折叠状态、分页或当前视图影响；非标题省略，旧客户端可忽略。
	HeadingChildren *bool  `json:"headingChildren,omitempty"`
	ID              string `json:"id"`
	Type            string `json:"type"`
	ParentID        string `json:"parentID"`
	ParentType      string `json:"parentType"`
	PreviousID      string `json:"previousID"`
	PreviousType    string `json:"previousType"`
	NextID          string `json:"nextID"`
	NextType        string `json:"nextType"`
}

type BlockPath struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	// 嵌入块的文档项提供独立标题，name 仍保留完整路径；旧响应可省略此字段。
	DocumentTitle string       `json:"documentTitle,omitempty"`
	Type          string       `json:"type"`
	SubType       string       `json:"subType"`
	Children      []*BlockPath `json:"children"`
	HasChildren   bool         `json:"hasChildren,omitempty"`
}

type BlockBreadcrumbChildren struct {
	Items   []*BlockPath `json:"items"`
	HasMore bool         `json:"hasMore"`
}

type BlockBreadcrumbRequest struct {
	BlockQueryRequest
	ExcludeTypes []string `json:"excludeTypes" api:"optional,nullable"`
}

type BlockBreadcrumbChildrenRequest struct {
	BlockBreadcrumbRequest
	Offset *float64 `json:"offset" api:"optional"`
	Limit  *float64 `json:"limit" api:"optional"`
}
