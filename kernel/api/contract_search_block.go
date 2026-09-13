package api

import (
	"time"

	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/model"
)

func searchBlockContracts(blocks []*model.Block) []*apicontract.SearchBlock {
	if blocks == nil {
		return nil
	}
	result := make([]*apicontract.SearchBlock, len(blocks))
	for i, block := range blocks {
		if block == nil {
			continue
		}
		converted := &apicontract.SearchBlock{
			Box: block.Box, Path: block.Path, HPath: block.HPath, ID: block.ID, RootID: block.RootID,
			ParentID: block.ParentID, Name: block.Name, Alias: block.Alias, Memo: block.Memo, Tag: block.Tag,
			Content: block.Content, Number: block.Number, FContent: block.FContent, Markdown: block.Markdown,
			Folded: block.Folded, Type: block.Type, SubType: block.SubType, RefText: block.RefText,
			Refs: searchBlockContracts(block.Refs), DefID: block.DefID, DefPath: block.DefPath, IAL: block.IAL,
			Children: searchBlockContracts(block.Children), Depth: block.Depth, Count: block.Count,
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
