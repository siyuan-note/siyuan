// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package av

import (
	"github.com/88250/gulu"
	"github.com/88250/lute/ast"
)

// 显式存储边界仅属于当前数据库身份；空笔记本 ID 表示普通工作区，不表示自动查找。
func (attrView *AttributeView) SetStorageContext(boxID string) error {
	if attrView == nil || !ast.IsNodeIDPattern(attrView.ID) {
		return ErrInvalidAttributeViewID
	}
	if boxID != "" && !ast.IsNodeIDPattern(boxID) {
		return ErrInvalidBoxID
	}
	attrView.storageContextID, attrView.storageContextBoxID = attrView.ID, boxID
	return nil
}

func (attrView *AttributeView) StorageContext() (boxID string, known bool) {
	if attrView != nil && attrView.storageContextID != "" && attrView.storageContextID == attrView.ID {
		return attrView.storageContextBoxID, true
	}
	return "", false
}

func (attrView *AttributeView) StoragePath() (path, boxID string) {
	if attrView == nil {
		return "", ""
	}
	if boxID, known := attrView.StorageContext(); known {
		return attributeViewDataPathByBox(attrView.ID, boxID), boxID
	}
	return FindAttributeViewPath(attrView.ID)
}

// 精确读取并固定边界，不修改按数据库 ID 维护的全局映射。
func ParseAttributeViewWithStorageContext(avID, boxID string) (*AttributeView, error) {
	if !ast.IsNodeIDPattern(avID) {
		return nil, ErrInvalidAttributeViewID
	}
	if boxID != "" && !ast.IsNodeIDPattern(boxID) {
		return nil, ErrInvalidBoxID
	}
	attrView, err := parseAttributeViewByPathInBoxWithOptions(attributeViewDataPathByBox(avID, boxID), boxID, true)
	if err != nil {
		return nil, err
	}
	if attrView == nil || attrView.ID != avID {
		return nil, ErrInvalidAttributeViewID
	}
	if err = attrView.SetStorageContext(boxID); err != nil {
		return nil, err
	}
	return attrView, nil
}

// 仅返回指定存储边界内登记的镜像块；调用方仍须校验该边界中的块树是否存在。
func GetAttributeViewBlockIDsInBox(avID, boxID string) ([]string, error) {
	if !ast.IsNodeIDPattern(avID) {
		return nil, ErrInvalidAttributeViewID
	}
	if boxID != "" && !ast.IsNodeIDPattern(boxID) {
		return nil, ErrInvalidBoxID
	}
	AttributeViewBlocksLock.Lock()
	defer AttributeViewBlocksLock.Unlock()
	relations, err := readMirrorBlocksWithErr(boxID)
	if err != nil {
		return nil, err
	}
	return relations[avID], nil
}

func GetSrcAvIDsInBoxWithErr(destID, boxID string) ([]string, error) {
	if boxID != "" && !ast.IsNodeIDPattern(boxID) {
		return nil, ErrInvalidBoxID
	}
	attributeViewRelationsLock.Lock()
	defer attributeViewRelationsLock.Unlock()
	relations, err := readRelations(boxID)
	if err != nil {
		return nil, err
	}
	return relations[destID], nil
}

// 在同一索引快照中遍历依赖，数据库全局映射的变化不能扩大刷新边界。
func GetSrcAvIDsForRefreshInBox(destIDs []string, boxID string) ([]string, error) {
	if boxID != "" && !ast.IsNodeIDPattern(boxID) {
		return nil, ErrInvalidBoxID
	}
	attributeViewRelationsLock.Lock()
	defer attributeViewRelationsLock.Unlock()
	relations, err := readRelations(boxID)
	if err != nil {
		return nil, err
	}
	return collectSrcAvIDsForRefresh(destIDs, func(id string) []string { return relations[id] }), nil
}

func RemoveAvRelInBoxWithErr(srcID, destID, boxID string) error {
	if !ast.IsNodeIDPattern(srcID) || !ast.IsNodeIDPattern(destID) {
		return ErrInvalidAttributeViewID
	}
	if boxID != "" && !ast.IsNodeIDPattern(boxID) {
		return ErrInvalidBoxID
	}
	attributeViewRelationsLock.Lock()
	defer attributeViewRelationsLock.Unlock()
	relations, err := readRelations(boxID)
	if err != nil {
		return err
	}
	if relations[destID] == nil {
		return nil
	}
	var sources []string
	for _, source := range relations[destID] {
		if source != srcID {
			sources = append(sources, source)
		}
	}
	relations[destID] = sources
	return writeRelations(boxID, relations)
}

func UpsertAvBackRelInBoxWithErr(srcID, destID, boxID string) error {
	if !ast.IsNodeIDPattern(srcID) || !ast.IsNodeIDPattern(destID) {
		return ErrInvalidAttributeViewID
	}
	if boxID != "" && !ast.IsNodeIDPattern(boxID) {
		return ErrInvalidBoxID
	}
	attributeViewRelationsLock.Lock()
	defer attributeViewRelationsLock.Unlock()
	relations, err := readRelations(boxID)
	if err != nil {
		return err
	}
	relations[destID] = gulu.Str.RemoveDuplicatedElem(append(relations[destID], srcID))
	return writeRelations(boxID, relations)
}
