package model

import (
	"errors"

	"github.com/siyuan-note/siyuan/kernel/av"
)

func (tx *Transaction) doSetAttrViewColAttributePanelVisibility(operation *Operation) *TxErr {
	if err := setAttrViewColAttributePanelVisibility(operation); nil != err {
		return &TxErr{code: TxErrHandleAttributeView, id: operation.AvID, msg: err.Error()}
	}
	return nil
}

func setAttrViewColAttributePanelVisibility(operation *Operation) error {
	visibility, ok := operation.Data.(string)
	if !ok {
		return errors.New("attribute panel visibility must be a string")
	}
	switch visibility {
	case "", "always", "hide-empty", "hide":
	default:
		return errors.New("invalid attribute panel visibility")
	}
	attrView, err := av.ParseAttributeView(operation.AvID)
	if nil != err {
		return err
	}
	key, err := attrView.GetKey(operation.ID)
	if nil != err {
		return err
	}
	key.AttributePanelVisibility = visibility
	return av.SaveAttributeView(attrView)
}
