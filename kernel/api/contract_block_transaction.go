package api

import (
	"encoding/json"
	"fmt"

	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/model"
)

func blockOperationContract(operation *model.Operation) (*apicontract.BlockOperation, error) {
	if operation == nil {
		return nil, nil
	}
	if operation.Srcs != nil || len(operation.CellUpdates) > 0 {
		return nil, fmt.Errorf("unexpected attribute view payload in block operation [%s]", operation.Action)
	}
	ret := &apicontract.BlockOperation{
		Action:            operation.Action,
		ID:                operation.ID,
		RootID:            operation.RootID,
		ParentID:          operation.ParentID,
		PreviousID:        operation.PreviousID,
		NextID:            operation.NextID,
		BlockIDs:          operation.BlockIDs,
		BlockID:           operation.BlockID,
		DeckID:            operation.DeckID,
		AvID:              operation.AvID,
		SrcIDs:            operation.SrcIDs,
		IsDetached:        operation.IsDetached,
		Name:              operation.Name,
		Typ:               operation.Typ,
		Format:            operation.Format,
		KeyID:             operation.KeyID,
		RowID:             operation.RowID,
		IsTwoWay:          operation.IsTwoWay,
		BackRelationKeyID: operation.BackRelationKeyID,
		RemoveDest:        operation.RemoveDest,
		Layout:            string(operation.Layout),
		GroupID:           operation.GroupID,
		TargetGroupID:     operation.TargetGroupID,
		ViewID:            operation.ViewID,
		ViewIDs:           operation.ViewIDs,
		IgnoreDefaultFill: operation.IgnoreDefaultFill,
	}
	// 业务模型中的多态字段按块操作的有限载荷绑定，拒绝不属于该协议的类型。
	data, err := json.Marshal(operation.Data)
	if err != nil {
		return nil, err
	}
	if err = json.Unmarshal(data, &ret.Data); err != nil {
		return nil, err
	}
	data, err = json.Marshal(operation.RetData)
	if err != nil {
		return nil, err
	}
	if err = json.Unmarshal(data, &ret.RetData); err != nil {
		return nil, err
	}
	data, err = json.Marshal(operation.Context)
	if err != nil {
		return nil, err
	}
	var contextFields map[string]*string
	if err = json.Unmarshal(data, &contextFields); err != nil {
		return nil, err
	}
	if contextFields != nil {
		ret.Context = make(map[string]string, len(contextFields))
		for key, value := range contextFields {
			if value == nil {
				return nil, fmt.Errorf("block operation context [%s] must be text", key)
			}
			ret.Context[key] = *value
		}
	}
	return ret, nil
}

func blockOperationsContract(operations []*model.Operation) ([]*apicontract.BlockOperation, error) {
	if operations == nil {
		return nil, nil
	}
	ret := make([]*apicontract.BlockOperation, len(operations))
	for i, operation := range operations {
		converted, err := blockOperationContract(operation)
		if err != nil {
			return nil, err
		}
		ret[i] = converted
	}
	return ret, nil
}

func blockTransactionContract(transaction *model.Transaction) (*apicontract.BlockTransaction, error) {
	if transaction == nil {
		return nil, nil
	}
	do, err := blockOperationsContract(transaction.DoOperations)
	if err != nil {
		return nil, err
	}
	undo, err := blockOperationsContract(transaction.UndoOperations)
	if err != nil {
		return nil, err
	}
	return &apicontract.BlockTransaction{Timestamp: transaction.Timestamp, DoOperations: do, UndoOperations: undo, TemplateDocTreePlanID: transaction.TemplateDocTreePlanID}, nil
}

func blockTransactionResponse(transaction *model.Transaction) apicontract.Response[*apicontract.BlockTransaction] {
	converted, err := blockTransactionContract(transaction)
	if err != nil {
		return apicontract.Failure[*apicontract.BlockTransaction](-1, err.Error())
	}
	return apicontract.Success(converted)
}

func blockTransactionsResponse(transactions []*model.Transaction) apicontract.Response[[]*apicontract.BlockTransaction] {
	var ret []*apicontract.BlockTransaction
	if transactions != nil {
		ret = make([]*apicontract.BlockTransaction, len(transactions))
	}
	for i, transaction := range transactions {
		converted, err := blockTransactionContract(transaction)
		if err != nil {
			return apicontract.Failure[[]*apicontract.BlockTransaction](-1, err.Error())
		}
		ret[i] = converted
	}
	return apicontract.Success(ret)
}
