// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

package model

import (
	"errors"
	"fmt"
	"strings"
	"unicode/utf8"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// AttributeViewCreateKey 描述创建数据库时需要按顺序初始化的字段。
type AttributeViewCreateKey struct {
	Name string `json:"name"`
	Type string `json:"type"`
	Icon string `json:"icon,omitempty"`
}

// AttributeViewCreateResult 描述创建数据库后可供调用方继续操作的标识和数据。
type AttributeViewCreateResult struct {
	BlockID       string
	AvID          string
	ViewID        string
	AttributeView *av.AttributeView
}

// CreateAttributeViewDatabase 创建数据库块和对应属性视图，并按照 keySpecs 的顺序初始化字段。
func CreateAttributeViewDatabase(parentID, previousID, nextID, name, primaryKeyName string, layout av.LayoutType,
	keySpecs []*AttributeViewCreateKey) (ret *AttributeViewCreateResult, err error) {
	if "" == parentID {
		return nil, errors.New("parent ID is required")
	}
	if "" != previousID && "" != nextID {
		return nil, errors.New("previous ID and next ID cannot both be specified")
	}
	if "" == previousID && "" == nextID {
		if err = treenode.CheckContainerParent(parentID); nil != err {
			return nil, err
		}
	}
	if "" == layout {
		layout = av.LayoutTypeTable
	}
	switch layout {
	case av.LayoutTypeTable, av.LayoutTypeGallery, av.LayoutTypeKanban:
	default:
		return nil, av.ErrWrongLayoutType
	}

	preparedKeys := make([]*av.Key, 0, len(keySpecs))
	for _, spec := range keySpecs {
		if nil == spec || "" == strings.TrimSpace(spec.Name) || "" == strings.TrimSpace(spec.Type) {
			return nil, errors.New("database field name and type are required")
		}
		key, keyErr := newAttributeViewKey(ast.NewNodeID(), strings.TrimSpace(spec.Name), strings.TrimSpace(spec.Type), spec.Icon,
			av.DateDisplayFormatFull)
		if nil != keyErr {
			return nil, keyErr
		}
		preparedKeys = append(preparedKeys, key)
	}

	blockID, avID := ast.NewNodeID(), ast.NewNodeID()
	data := fmt.Sprintf(`<div class="av" data-node-id="%s" data-av-id="%s" data-type="NodeAttributeView" data-av-type="%s"></div>`,
		blockID, avID, layout)
	operation := &Operation{
		Action:     "insert",
		Data:       data,
		ParentID:   parentID,
		PreviousID: previousID,
		NextID:     nextID,
	}
	FlushTxQueue()
	if err = PerformTxSync(&Transaction{DoOperations: []*Operation{operation}}); nil != err {
		return nil, err
	}
	blockID = operation.ID

	_, attrView, _, err := RenderAttributeViewWithTarget(blockID, avID, "", "", 1, 1, nil, layout, true, true, "", "")
	if nil != err {
		return nil, databaseCreationError(err, cleanupCreatedAttributeView(blockID, avID))
	}
	if err = configureCreatedAttributeView(attrView, name, primaryKeyName, preparedKeys); nil != err {
		return nil, databaseCreationError(err, cleanupCreatedAttributeView(blockID, avID))
	}

	view, viewErr := attrView.GetFirstView()
	if nil != viewErr {
		return nil, databaseCreationError(viewErr, cleanupCreatedAttributeView(blockID, avID))
	}
	if err = SetDatabaseBlockView(blockID, avID, view.ID); nil != err {
		return nil, databaseCreationError(err, cleanupCreatedAttributeView(blockID, avID))
	}

	if bt := treenode.GetBlockTree(blockID); nil != bt {
		util.PushReloadProtyle(bt.RootID)
	}
	ReloadAttrView(avID)
	ret = &AttributeViewCreateResult{BlockID: blockID, AvID: avID, ViewID: view.ID, AttributeView: attrView}
	return
}

func configureCreatedAttributeView(attrView *av.AttributeView, name, primaryKeyName string, preparedKeys []*av.Key) (err error) {
	if nil == attrView {
		return errors.New("attribute view is required")
	}
	currentView, err := attrView.GetFirstView()
	if nil != err {
		return
	}
	blockKeyValues := attrView.GetBlockKeyValues()
	if nil == blockKeyValues || nil == blockKeyValues.Key {
		return errors.New("attribute view has no primary key field")
	}

	if name = strings.TrimSpace(name); "" != name {
		name = strings.ReplaceAll(name, "\n", " ")
		if 512 < utf8.RuneCountInString(name) {
			name = string([]rune(name)[:512])
		}
		attrView.Name = name
	}
	if primaryKeyName = strings.TrimSpace(primaryKeyName); "" != primaryKeyName {
		blockKeyValues.Key.Name = primaryKeyName
	}

	retainedKeyValues := []*av.KeyValues{blockKeyValues}
	retainedKeyIDs := map[string]bool{blockKeyValues.Key.ID: true}
	var kanbanGroupKey *av.Key
	if av.LayoutTypeKanban == currentView.LayoutType {
		for _, key := range preparedKeys {
			if av.KeyTypeSelect == key.Type {
				kanbanGroupKey = key
				break
			}
		}
		if nil == kanbanGroupKey {
			for _, keyValues := range attrView.KeyValues {
				if nil != keyValues && nil != keyValues.Key && av.KeyTypeSelect == keyValues.Key.Type {
					retainedKeyValues = append(retainedKeyValues, keyValues)
					retainedKeyIDs[keyValues.Key.ID] = true
					kanbanGroupKey = keyValues.Key
					break
				}
			}
		}
	}
	attrView.KeyValues = retainedKeyValues
	retainCreatedAttributeViewFields(attrView, retainedKeyIDs)

	previousKeyID := blockKeyValues.Key.ID
	if 1 < len(retainedKeyValues) {
		previousKeyID = retainedKeyValues[len(retainedKeyValues)-1].Key.ID
	}
	for _, key := range preparedKeys {
		addAttributeViewKey(attrView, currentView, key, previousKeyID)
		previousKeyID = key.ID
	}

	attrView.KeyIDs = make([]string, 0, len(attrView.KeyValues))
	for _, keyValues := range attrView.KeyValues {
		if nil != keyValues && nil != keyValues.Key {
			attrView.KeyIDs = append(attrView.KeyIDs, keyValues.Key.ID)
		}
	}
	if av.LayoutTypeKanban == currentView.LayoutType && nil != kanbanGroupKey {
		currentView.Group = &av.ViewGroup{Field: kanbanGroupKey.ID}
	}
	regenAttrViewGroups(attrView)
	return av.SaveAttributeView(attrView)
}

func retainCreatedAttributeViewFields(attrView *av.AttributeView, retainedKeyIDs map[string]bool) {
	for _, view := range attrView.Views {
		if nil == view {
			continue
		}
		if nil != view.Table {
			columns := view.Table.Columns[:0]
			for _, column := range view.Table.Columns {
				if nil != column && retainedKeyIDs[column.ID] {
					columns = append(columns, column)
				}
			}
			view.Table.Columns = columns
		}
		if nil != view.Gallery {
			fields := view.Gallery.CardFields[:0]
			for _, field := range view.Gallery.CardFields {
				if nil != field && retainedKeyIDs[field.ID] {
					fields = append(fields, field)
				}
			}
			view.Gallery.CardFields = fields
		}
		if nil != view.Kanban {
			fields := view.Kanban.Fields[:0]
			for _, field := range view.Kanban.Fields {
				if nil != field && retainedKeyIDs[field.ID] {
					fields = append(fields, field)
				}
			}
			view.Kanban.Fields = fields
		}
	}
}

func cleanupCreatedAttributeView(blockID, avID string) (err error) {
	if "" != blockID {
		err = PerformTxSync(&Transaction{DoOperations: []*Operation{{Action: "delete", ID: blockID}}})
	}
	avJSONPath, boxID := av.FindAttributeViewPath(avID)
	if "" != avJSONPath && filelock.IsExist(avJSONPath) {
		err = errors.Join(err, filelock.RemoveWithoutFatal(avJSONPath))
	}
	cache.RemoveAVDataInBox(avID, boxID)
	return
}

func databaseCreationError(createErr, cleanupErr error) error {
	if nil == cleanupErr {
		return createErr
	}
	return fmt.Errorf("%w; cleanup failed: %v", createErr, cleanupErr)
}
