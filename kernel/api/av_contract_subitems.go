// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/av"
)

func fromContractAVNestedRequest(value *apicontract.AVNestedRequest) *av.NestedRequest {
	if value == nil {
		return nil
	}
	ret := &av.NestedRequest{ExpandedIDs: value.ExpandedIDs, GroupExpandedIDs: value.GroupExpandedIDs, ChildPaging: map[string]*av.NestedPage{}}
	for id, paging := range value.ChildPaging {
		if paging != nil {
			ret.ChildPaging[id] = &av.NestedPage{Page: avPage(paging.Page, 1), PageSize: avPage(paging.PageSize, 50)}
		}
	}
	return ret
}

func toContractAVNestedResult(value *av.NestedResult) *apicontract.AVNestedResult {
	if value == nil {
		return nil
	}
	ret := &apicontract.AVNestedResult{Page: value.Page, PageSize: value.PageSize, RootCount: value.RootCount, RootLoaded: value.RootLoaded, MatchedCount: value.MatchedCount, ChildPaging: map[string]*apicontract.AVNestedChildPage{}}
	for id, paging := range value.ChildPaging {
		ret.ChildPaging[id] = &apicontract.AVNestedChildPage{Page: paging.Page, PageSize: paging.PageSize, Total: paging.Total, Loaded: paging.Loaded}
	}
	return ret
}

func toContractAVItemHierarchy(value *av.ItemHierarchy) *apicontract.AVItemHierarchy {
	if value == nil {
		return nil
	}
	return &apicontract.AVItemHierarchy{ParentID: value.ParentID, Depth: value.Depth, ChildCount: value.ChildCount, Context: value.Context, Expanded: value.Expanded}
}

func toContractAVSubItemsConfig(value *av.SubItemsConfig) *apicontract.AVSubItemsConfig {
	if value == nil {
		return nil
	}
	return &apicontract.AVSubItemsConfig{Enabled: value.Enabled, ParentKeyID: value.ParentKeyID, ChildrenKeyID: value.ChildrenKeyID}
}
