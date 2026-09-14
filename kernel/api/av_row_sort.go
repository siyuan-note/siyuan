package api

import (
	"fmt"

	"github.com/88250/gulu"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var getAttributeViewRowSort = contractHandler(apicontract.GetAttributeViewRowSort, func(c *gin.Context, request apicontract.GetAttributeViewRowSortRequest) apicontract.Response[apicontract.AVRowSortPreview] {
	ret := gulu.Ret.NewResult()
	if util.InvalidIDPattern(request.AvID, ret) || util.InvalidIDPattern(request.ViewID, ret) {
		return contractFailure[apicontract.AVRowSortPreview](ret)
	}
	input := model.AttributeViewRowSortRequest{AvID: request.AvID, BlockID: request.BlockID, ViewID: request.ViewID, GroupID: request.GroupID, ItemIDs: request.ItemIDs, PreviousID: request.PreviousID, NextID: request.NextID}
	preview, err := model.PrepareAttributeViewRowSort(&input)
	if nil != err {
		return apicontract.Failure[apicontract.AVRowSortPreview](-1, err.Error())
	}
	doOperations, err := avRowSortOperations(preview.DoOperations)
	if err != nil {
		return apicontract.Failure[apicontract.AVRowSortPreview](-1, err.Error())
	}
	undoOperations, err := avRowSortOperations(preview.UndoOperations)
	if err != nil {
		return apicontract.Failure[apicontract.AVRowSortPreview](-1, err.Error())
	}
	return apicontract.Success(apicontract.AVRowSortPreview{Conflict: preview.Conflict, DoOperations: doOperations, UndoOperations: undoOperations})
})

func avRowOrder(value *model.AttributeViewRowOrder) *apicontract.AVRowOrder {
	if value == nil {
		return nil
	}
	return &apicontract.AVRowOrder{ItemIDs: value.ItemIDs, Groups: value.Groups, Sorts: avContractSlice(value.Sorts, toContractAVViewSort)}
}

func avRowSortOperations(values []*model.Operation) ([]*apicontract.AVRowSortOperation, error) {
	if values == nil {
		return nil, nil
	}
	ret := make([]*apicontract.AVRowSortOperation, len(values))
	for i, value := range values {
		if value == nil {
			continue
		}
		data, ok := value.Data.(*model.AttributeViewRowOrderChange)
		if !ok || value.Action != "sortAttrViewRow" {
			return nil, fmt.Errorf("unsupported attribute view row sort operation %s", value.Action)
		}
		var change *apicontract.AVRowOrderChange
		if data != nil {
			change = &apicontract.AVRowOrderChange{RowOrder: avRowOrder(data.RowOrder), Expected: avRowOrder(data.Expected), ValidateGroup: data.ValidateGroup}
		}
		ret[i] = &apicontract.AVRowSortOperation{Action: value.Action, Data: change, ID: value.ID, RootID: value.RootID, ParentID: value.ParentID, PreviousID: value.PreviousID, NextID: value.NextID, BlockIDs: value.BlockIDs, BlockID: value.BlockID, DeckID: value.DeckID, AvID: value.AvID, SrcIDs: value.SrcIDs, IsDetached: value.IsDetached, Name: value.Name, Typ: value.Typ, Format: value.Format, KeyID: value.KeyID, RowID: value.RowID, IsTwoWay: value.IsTwoWay, BackRelationKeyID: value.BackRelationKeyID, RemoveDest: value.RemoveDest, Layout: string(value.Layout), GroupID: value.GroupID, TargetGroupID: value.TargetGroupID, ViewID: value.ViewID, ViewIDs: value.ViewIDs, IgnoreDefaultFill: value.IgnoreDefaultFill}
	}
	return ret, nil
}
