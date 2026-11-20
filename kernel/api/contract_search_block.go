// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"time"

	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/model"
)

func searchBlockContracts(blocks []*model.Block) []*apicontract.SearchBlock {
	return searchBlockContractsWithReader(blocks, false)
}

// searchReaderBlockContracts 转换只读角色的搜索结果，剔除编辑器专属的块备注。
func searchReaderBlockContracts(blocks []*model.Block) []*apicontract.SearchBlock {
	return searchBlockContractsWithReader(blocks, true)
}

func searchBlockContractsWithReader(blocks []*model.Block, forReader bool) []*apicontract.SearchBlock {
	if blocks == nil {
		return nil
	}
	result := make([]*apicontract.SearchBlock, len(blocks))
	for i, block := range blocks {
		if block == nil {
			continue
		}
		memo, ial := block.Memo, block.IAL
		if forReader {
			memo, ial = "", readerBlockIAL(block.IAL)
		}
		converted := &apicontract.SearchBlock{
			Box: block.Box, Path: block.Path, HPath: block.HPath, ID: block.ID, RootID: block.RootID,
			ParentID: block.ParentID, Name: block.Name, Alias: block.Alias, Memo: memo, Tag: block.Tag,
			Content: block.Content, Number: block.Number, FContent: block.FContent, Markdown: block.Markdown,
			Folded: block.Folded, Type: block.Type, SubType: block.SubType, RefText: block.RefText,
			Refs: searchBlockContractsWithReader(block.Refs, forReader), DefID: block.DefID, DefPath: block.DefPath, IAL: ial,
			Children: searchBlockContractsWithReader(block.Children, forReader), Depth: block.Depth, Count: block.Count,
			RefCount: block.RefCount, Sort: block.Sort, Created: block.Created, Updated: block.Updated,
			RiffCardID: block.RiffCardID,
		}
		if card := block.RiffCard; card != nil {
			converted.RiffCard = &apicontract.SearchBlockCard{Due: card.Due.Format(time.RFC3339Nano),
				Reps: card.Reps, Lapses: card.Lapses, State: int(card.State), LastReview: card.LastReview.Format(time.RFC3339Nano)}
		}
		result[i] = converted
	}
	return result
}

// readerBlockIAL 复制块属性并移除编辑器专属的备注，避免修改模型对象。
func readerBlockIAL(value map[string]string) map[string]string {
	if nil == value {
		return nil
	}
	ret := make(map[string]string, len(value))
	for key, val := range value {
		if "memo" != key {
			ret[key] = val
		}
	}
	return ret
}

func searchPathContracts(values []*model.Path) []*apicontract.SearchPath {
	return searchPathContractsWithReader(values, false)
}

// searchReaderPathContracts 转换只读角色的文档大纲，剔除编辑器专属的块备注。
func searchReaderPathContracts(values []*model.Path) []*apicontract.SearchPath {
	return searchPathContractsWithReader(values, true)
}

func searchPathContractsWithReader(values []*model.Path, forReader bool) []*apicontract.SearchPath {
	if values == nil {
		return nil
	}
	result := make([]*apicontract.SearchPath, len(values))
	for i, value := range values {
		if value != nil {
			result[i] = &apicontract.SearchPath{ID: value.ID, Box: value.Box, Name: value.Name, NameIsHTML: value.NameIsHTML, Number: value.Number, HPath: value.HPath, Type: value.Type, NodeType: value.NodeType, SubType: value.SubType, Blocks: searchBlockContractsWithReader(value.Blocks, forReader), Children: searchPathContractsWithReader(value.Children, forReader), Depth: value.Depth, Count: value.Count, Folded: value.Folded, Updated: value.Updated, Created: value.Created}
		}
	}
	return result
}
