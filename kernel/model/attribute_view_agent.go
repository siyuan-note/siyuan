// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

package model

import (
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// GetAttributeViewViewTarget 根据数据库块和视图 ID 精确读取视图，避免回退到首个视图。
func GetAttributeViewViewTarget(avID, blockID, viewID string) (*av.AttributeView, *av.View, error) {
	if "" == avID || "" == blockID || "" == viewID {
		return nil, nil, errors.New("avID, blockID and viewID are required")
	}
	attrView, err := avParseView(avID, blockID)
	if nil != err {
		return nil, nil, err
	}
	if _, _, err = getAttributeViewInstanceNode(attrView, blockID); nil != err {
		return nil, nil, err
	}
	view := attrView.GetView(viewID)
	if nil == view {
		return nil, nil, av.ErrViewNotFound
	}
	return attrView, view, nil
}

// AttributeViewViewConfigRevision 标识视图配置版本，供智能体在整组更新前检查配置是否变化。
func AttributeViewViewConfigRevision(view *av.View) string {
	if nil == view {
		return ""
	}
	data, _ := json.Marshal(struct {
		Filters []*av.ViewFilter `json:"filters"`
		Sorts   []*av.ViewSort   `json:"sorts"`
		Group   *av.ViewGroup    `json:"group"`
		Layout  av.LayoutType    `json:"layout"`
	}{view.Filters, view.Sorts, view.Group, view.LayoutType})
	digest := sha256.Sum256(data)
	return fmt.Sprintf("%x", digest)
}

func checkAttributeViewViewConfigRevision(view *av.View, expected string) error {
	if "" == expected {
		return errors.New("revision is required; read the view configuration before updating it")
	}
	if AttributeViewViewConfigRevision(view) != expected {
		return errors.New("view configuration changed; read it again before updating")
	}
	return nil
}

// SetAttributeViewViewFilters 用完整规则树替换指定视图的筛选配置。
func SetAttributeViewViewFilters(avID, blockID, viewID, revision string, filters []*av.ViewFilter) error {
	FlushTxQueue()
	attrView, view, err := GetAttributeViewViewTarget(avID, blockID, viewID)
	if nil != err {
		return err
	}
	if err = checkAttributeViewViewConfigRevision(view, revision); nil != err {
		return err
	}
	if 1 != len(filters) || nil == filters[0] || !filters[0].IsGroup() {
		filters = []*av.ViewFilter{{Combination: av.FilterCombinationAnd, Filters: filters}}
	}
	if err = av.ValidateFilterDepth(filters); nil != err {
		return err
	}
	view.Filters = filters
	if err = avSaveView(attrView, blockID); nil != err {
		return err
	}
	ReloadAttrView(avID)
	return nil
}

// SetAttributeViewViewSorts 用完整规则数组替换指定视图的排序配置。
func SetAttributeViewViewSorts(avID, blockID, viewID, revision string, sorts []*av.ViewSort) error {
	FlushTxQueue()
	attrView, view, err := GetAttributeViewViewTarget(avID, blockID, viewID)
	if nil != err {
		return err
	}
	if err = checkAttributeViewViewConfigRevision(view, revision); nil != err {
		return err
	}
	view.Sorts = sorts
	if err = avSaveView(attrView, blockID); nil != err {
		return err
	}
	ReloadAttrView(avID)
	return nil
}

// SetAttributeViewViewGroup 设置指定视图的分组配置，空字段清除分组。
func SetAttributeViewViewGroup(avID, blockID, viewID, revision string, group *av.ViewGroup) error {
	FlushTxQueue()
	attrView, view, err := GetAttributeViewViewTarget(avID, blockID, viewID)
	if nil != err {
		return err
	}
	if err = checkAttributeViewViewConfigRevision(view, revision); nil != err {
		return err
	}
	setAttributeViewGroup(attrView, view, group)
	if err = avSaveView(attrView, blockID); nil != err {
		return err
	}
	ReloadAttrView(avID)
	return nil
}

// AddAttributeViewView 通过现有事务创建视图并同步数据库块的显示状态。
func AddAttributeViewView(avID, blockID, name string, layout av.LayoutType) (string, error) {
	FlushTxQueue()
	if _, _, err := getAttributeViewViewCarrier(avID, blockID); nil != err {
		return "", err
	}
	viewID := ast.NewNodeID()
	op := &Operation{Action: "addAttrViewView", AvID: avID, BlockID: blockID, ID: viewID, Name: strings.TrimSpace(name), Layout: layout}
	if err := PerformTransactionSync(&Transaction{DoOperations: []*Operation{op}}); nil != err {
		return "", err
	}
	ReloadAttrView(avID)
	return viewID, nil
}

// DuplicateAttributeViewView 通过现有事务复制视图配置并同步数据库块的显示状态。
func DuplicateAttributeViewView(avID, blockID, sourceViewID, name string) (string, error) {
	FlushTxQueue()
	if _, _, err := GetAttributeViewViewTarget(avID, blockID, sourceViewID); nil != err {
		return "", err
	}
	viewID := ast.NewNodeID()
	op := &Operation{Action: "duplicateAttrViewView", AvID: avID, BlockID: blockID, PreviousID: sourceViewID, ID: viewID, Name: strings.TrimSpace(name)}
	if err := PerformTransactionSync(&Transaction{DoOperations: []*Operation{op}}); nil != err {
		return "", err
	}
	ReloadAttrView(avID)
	return viewID, nil
}

// RemoveAttributeViewView 删除指定视图，保留至少一个视图并更新镜像数据库块。
func RemoveAttributeViewView(avID, blockID, viewID string) error {
	FlushTxQueue()
	attrView, _, err := GetAttributeViewViewTarget(avID, blockID, viewID)
	if nil != err {
		return err
	}
	if len(attrView.Views) <= 1 {
		return errors.New("cannot remove the last database view")
	}
	op := &Operation{Action: "removeAttrViewView", AvID: avID, BlockID: blockID, ID: viewID}
	if err = PerformTransactionSync(&Transaction{DoOperations: []*Operation{op}}); nil != err {
		return err
	}
	ReloadAttrView(avID)
	return nil
}

// AttributeViewViewUpdate 仅修改已提供的视图元数据，空字符串保留清空语义。
type AttributeViewViewUpdate struct {
	Name *string
	Icon *string
	Desc *string
}

// UpdateAttributeViewView 通过现有事务修改指定视图的元数据。
func UpdateAttributeViewView(avID, blockID, viewID string, update AttributeViewViewUpdate) error {
	FlushTxQueue()
	if _, _, err := GetAttributeViewViewTarget(avID, blockID, viewID); nil != err {
		return err
	}
	var operations []*Operation
	if nil != update.Name {
		operations = append(operations, &Operation{Action: "setAttrViewViewName", AvID: avID, BlockID: blockID, ID: viewID, Data: *update.Name})
	}
	if nil != update.Icon {
		icon := strings.TrimSpace(*update.Icon)
		if "" != icon {
			var valid bool
			if icon, valid = util.FilterIconValue(icon); !valid {
				return errors.New("invalid view icon")
			}
		}
		operations = append(operations, &Operation{Action: "setAttrViewViewIcon", AvID: avID, BlockID: blockID, ID: viewID, Data: icon})
	}
	if nil != update.Desc {
		operations = append(operations, &Operation{Action: "setAttrViewViewDesc", AvID: avID, BlockID: blockID, ID: viewID, Data: *update.Desc})
	}
	if 0 == len(operations) {
		return errors.New("at least one of name, icon or desc is required")
	}
	if err := PerformTransactionSync(&Transaction{DoOperations: operations}); nil != err {
		return err
	}
	ReloadAttrView(avID)
	return nil
}

// MoveAttributeViewView 将指定视图移到前置视图之后，空前置 ID 表示移到首位。
func MoveAttributeViewView(avID, blockID, viewID, previousViewID string) error {
	FlushTxQueue()
	attrView, _, err := GetAttributeViewViewTarget(avID, blockID, viewID)
	if nil != err {
		return err
	}
	if "" != previousViewID && nil == attrView.GetView(previousViewID) {
		return av.ErrViewNotFound
	}
	op := &Operation{Action: "sortAttrViewView", AvID: avID, BlockID: blockID, ID: viewID, PreviousID: previousViewID}
	if err = PerformTransactionSync(&Transaction{DoOperations: []*Operation{op}}); nil != err {
		return err
	}
	ReloadAttrView(avID)
	return nil
}

// SetAttributeViewBlockVisibleViews 通过现有事务保存指定数据库块的可见视图集合。
func SetAttributeViewBlockVisibleViews(avID, blockID string, viewIDs []string) error {
	FlushTxQueue()
	if _, _, err := getAttributeViewViewCarrier(avID, blockID); nil != err {
		return err
	}
	op := &Operation{Action: "setAttrViewBlockVisibleViews", AvID: avID, BlockID: blockID, ViewIDs: viewIDs}
	return PerformTransactionSync(&Transaction{DoOperations: []*Operation{op}})
}

// GetDatabaseBlockVisibleViewIDs 读取指定数据库块的可见视图，并按数据库中的顺序返回。
func GetDatabaseBlockVisibleViewIDs(attrView *av.AttributeView, blockID string) ([]string, error) {
	node, _, err := getAttributeViewInstanceNode(attrView, blockID)
	if nil != err {
		return nil, err
	}
	return attrView.GetVisibleViewIDs(node.IALAttr(av.NodeAttrVisibleViewIDs)), nil
}

func getAttributeViewViewCarrier(avID, blockID string) (*av.AttributeView, *av.View, error) {
	if "" == avID || "" == blockID {
		return nil, nil, errors.New("avID and blockID are required")
	}
	attrView, err := avParseView(avID, blockID)
	if nil != err {
		return nil, nil, err
	}
	if _, _, err = getAttributeViewInstanceNode(attrView, blockID); nil != err {
		return nil, nil, err
	}
	view, err := getAttrViewViewByBlockID(attrView, blockID)
	return attrView, view, err
}
