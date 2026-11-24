// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/model"
)

func bookmarkContracts(values *model.Bookmarks, forReader bool) []*apicontract.Bookmark {
	if values == nil || *values == nil {
		return nil
	}
	result := make([]*apicontract.Bookmark, len(*values))
	for i, value := range *values {
		if value != nil {
			blocks := searchBlockContracts(value.Blocks)
			if forReader {
				blocks = searchReaderBlockContracts(value.Blocks)
				// markdown 与 fcontent 由 SQL 索引生成，可能带出行级备注，读者只读取渲染后的 content
				for _, block := range blocks {
					if nil != block {
						block.Markdown, block.FContent = "", ""
					}
				}
			}
			result[i] = &apicontract.Bookmark{Name: string(value.Name), Blocks: blocks, Type: value.Type, Depth: value.Depth, Count: value.Count}
		}
	}
	return result
}
