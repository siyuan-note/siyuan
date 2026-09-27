// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"encoding/json"
	"fmt"

	"github.com/siyuan-note/siyuan/kernel/av"
)

func (tx *Transaction) doSetAttrViewConditionalColors(operation *Operation) *TxErr {
	if err := setAttrViewConditionalColors(operation); nil != err {
		return &TxErr{code: TxErrHandleAttributeView, id: operation.AvID, msg: err.Error()}
	}
	return nil
}

func setAttrViewConditionalColors(operation *Operation) error {
	if nil == operation.Data {
		return fmt.Errorf("conditional color rules are required")
	}
	data, err := json.Marshal(operation.Data)
	if nil != err {
		return err
	}
	var rules []*av.ConditionalColorRule
	if err = json.Unmarshal(data, &rules); nil != err {
		return err
	}
	if nil == rules {
		return fmt.Errorf("conditional color rules must be an array")
	}
	if err = av.ValidateConditionalColors(rules); nil != err {
		return err
	}
	attrView, err := av.ParseAttributeView(operation.AvID)
	if nil != err {
		return err
	}
	view, err := getAttrViewOperationView(attrView, operation)
	if nil != err {
		return err
	}
	view.ConditionalColors = rules
	return av.SaveAttributeView(attrView)
}
