// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/model"
)

func bookmarkContracts(values *model.Bookmarks) []*apicontract.Bookmark {
	if values == nil || *values == nil {
		return nil
	}
	result := make([]*apicontract.Bookmark, len(*values))
	for i, value := range *values {
		if value != nil {
			result[i] = &apicontract.Bookmark{Name: string(value.Name), Blocks: searchBlockContracts(value.Blocks), Type: value.Type, Depth: value.Depth, Count: value.Count}
		}
	}
	return result
}
