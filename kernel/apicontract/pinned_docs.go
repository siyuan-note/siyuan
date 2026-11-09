// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package apicontract

type PinnedDoc struct {
	ID               string `json:"id"`
	Notebook         string `json:"notebook"`
	Name             string `json:"name"`
	Path             string `json:"path"`
	Icon             string `json:"icon"`
	HSize            string `json:"hSize"`
	HMtime           string `json:"hMtime"`
	HCtime           string `json:"hCtime"`
	Name1            string `json:"name1"`
	Alias            string `json:"alias"`
	Memo             string `json:"memo"`
	Bookmark         string `json:"bookmark"`
	SubFileCount     int    `json:"subFileCount"`
	Unavailable      bool   `json:"unavailable"`
	ChildrenSortMode *int   `json:"childrenSortMode"`
	// SpecTooNew 为 true 时源版本高于当前客户端支持的版本，名称等字段只来自占位读取，文档不可打开或编辑。
	SpecTooNew bool `json:"specTooNew,omitempty"`
}

type UpdatePinnedDocsRequest struct {
	IDs      []string `json:"ids"`
	Action   string   `json:"action"`
	TargetID string   `json:"targetID" api:"optional"`
	After    bool     `json:"after" api:"optional"`
}
