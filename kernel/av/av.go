// SiYuan - Refactor your thinking
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

// Package av 包含了属性视图（Attribute View）相关的实现。
package av

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/88250/gulu"
	"github.com/88250/lute/ast"
	jsoniter "github.com/json-iterator/go"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// AttributeView 描述了属性视图的结构。
type AttributeView struct {
	Spec      int          `json:"spec"`      // 格式版本
	ID        string       `json:"id"`        // 属性视图 ID
	Name      string       `json:"name"`      // 属性视图名称
	KeyValues []*KeyValues `json:"keyValues"` // 属性视图属性键值
	KeyIDs    []string     `json:"keyIDs"`    // 属性视图属性键 ID，用于排序
	ViewID    string       `json:"viewID"`    // 当前视图 ID
	Views     []*View      `json:"views"`     // 视图

	RenderedViewables map[string]Viewable `json:"-"` // 已经渲染好的视图
}

// KeyValues 描述了属性视图属性键值列表的结构。
type KeyValues struct {
	Key    *Key     `json:"key"`              // 属性视图属性键
	Values []*Value `json:"values,omitempty"` // 属性视图属性值列表
}

func (kValues *KeyValues) GetValue(blockID string) (ret *Value) {
	for _, v := range kValues.Values {
		if v.BlockID == blockID {
			ret = v
			return
		}
	}
	return
}

func (kValues *KeyValues) GetBlockValue() (ret *Value) {
	for _, v := range kValues.Values {
		if KeyTypeBlock == v.Type {
			ret = v
			return
		}
	}
	return
}

func GetKeyBlockValue(blockKeyValues []*KeyValues) (ret *Value) {
	for _, kv := range blockKeyValues {
		if KeyTypeBlock == kv.Key.Type && 0 < len(kv.Values) {
			ret = kv.Values[0]
			break
		}
	}
	return
}

func GetValue(keyValues []*KeyValues, keyID, itemID string) (ret *Value) {
	for _, kv := range keyValues {
		if kv.Key.ID == keyID {
			for _, v := range kv.Values {
				if v.BlockID == itemID {
					ret = v
					return
				}
			}
		}
	}
	return
}

// KeyType 描述了属性视图属性字段的类型。
type KeyType string

const (
	KeyTypeBlock      KeyType = "block"      // 主键
	KeyTypeText       KeyType = "text"       // 文本
	KeyTypeNumber     KeyType = "number"     // 数字
	KeyTypeDate       KeyType = "date"       // 日期
	KeyTypeSelect     KeyType = "select"     // 单选
	KeyTypeMSelect    KeyType = "mSelect"    // 多选
	KeyTypeURL        KeyType = "url"        // URL
	KeyTypeEmail      KeyType = "email"      // Email
	KeyTypePhone      KeyType = "phone"      // 电话
	KeyTypeMAsset     KeyType = "mAsset"     // 资源
	KeyTypeTemplate   KeyType = "template"   // 模板
	KeyTypeCreated    KeyType = "created"    // 创建时间
	KeyTypeUpdated    KeyType = "updated"    // 更新时间
	KeyTypeCheckbox   KeyType = "checkbox"   // 复选框
	KeyTypeRelation   KeyType = "relation"   // 关联
	KeyTypeRollup     KeyType = "rollup"     // 汇总
	KeyTypeLineNumber KeyType = "lineNumber" // 行号
)

// Key 描述了属性视图属性字段的基础结构。
type Key struct {
	ID   string  `json:"id"`   // 字段 ID
	Name string  `json:"name"` // 字段名
	Type KeyType `json:"type"` // 字段类型
	Icon string  `json:"icon"` // 字段图标
	Desc string  `json:"desc"` // 字段描述

	// 以下是某些列类型的特有属性

	// 单选/多选
	Options []*SelectOption `json:"options,omitempty"` // 选项列表

	// 数字
	NumberFormat NumberFormat `json:"numberFormat"` // 列数字格式化

	// 模板
	Template string `json:"template"` // 模板内容

	// 关联
	Relation *Relation `json:"relation,omitempty"` // 关联信息

	// 汇总
	Rollup *Rollup `json:"rollup,omitempty"` // 汇总信息

	// 日期
	Date *Date `json:"date,omitempty"` // 日期设置

	// 创建时间
	Created *Created `json:"created,omitempty"` // 创建时间设置

	// 更新时间
	Updated *Updated `json:"updated,omitempty"` // 更新时间设置
}

func NewKey(id, name, icon string, keyType KeyType) *Key {
	return &Key{
		ID:   id,
		Name: name,
		Type: keyType,
		Icon: icon,
	}
}

func (k *Key) GetOption(name string) (ret *SelectOption) {
	for _, option := range k.Options {
		if option.Name == name {
			ret = option
			return
		}
	}
	return
}

type Created struct {
	IncludeTime bool `json:"includeTime"` // 是否填充具体时间 Add `Include time` switch to database creation time field and update time field https://github.com/siyuan-note/siyuan/issues/12091
}

type Updated struct {
	IncludeTime bool `json:"includeTime"` // 是否填充具体时间 Add `Include time` switch to database creation time field and update time field https://github.com/siyuan-note/siyuan/issues/12091
}

type Date struct {
	AutoFillNow      bool `json:"autoFillNow"`      // 是否自动填充当前时间 The database date field supports filling the current time by default https://github.com/siyuan-note/siyuan/issues/10823
	FillSpecificTime bool `json:"fillSpecificTime"` // 是否填充具体时间 Add `Default fill specific time` switch to database date field https://github.com/siyuan-note/siyuan/issues/12089
}

type Rollup struct {
	RelationKeyID string      `json:"relationKeyID"` // 关联字段 ID
	KeyID         string      `json:"keyID"`         // 目标字段 ID
	Calc          *RollupCalc `json:"calc"`          // 计算方式
}

type RollupCalc struct {
	Operator CalcOperator `json:"operator"`
	Result   *Value       `json:"result"`
}

type Relation struct {
	AvID      string `json:"avID"`      // 关联的属性视图 ID
	IsTwoWay  bool   `json:"isTwoWay"`  // 是否双向关联
	BackKeyID string `json:"backKeyID"` // 双向关联时回链关联列的 ID
}

type SelectOption struct {
	Name  string `json:"name"`  // 选项名称
	Color string `json:"color"` // 选项颜色
	Desc  string `json:"desc"`  // 选项描述
}

// View 描述了视图的结构。
type View struct {
	ID               string         `json:"id"`                // 视图 ID
	Icon             string         `json:"icon"`              // 视图图标
	Name             string         `json:"name"`              // 视图名称
	HideAttrViewName bool           `json:"hideAttrViewName"`  // 是否隐藏属性视图名称
	Desc             string         `json:"desc"`              // 视图描述
	Filters          []*ViewFilter  `json:"filters,omitempty"` // 过滤规则
	Sorts            []*ViewSort    `json:"sorts,omitempty"`   // 排序规则
	PageSize         int            `json:"pageSize"`          // 每页条目数
	LayoutType       LayoutType     `json:"type"`              // 当前布局类型
	Table            *LayoutTable   `json:"table,omitempty"`   // 表格布局
	Gallery          *LayoutGallery `json:"gallery,omitempty"` // 卡片布局
	Kanban           *LayoutKanban  `json:"kanban,omitempty"`  // 看板布局
	ItemIDs          []string       `json:"itemIds,omitempty"` // 项目 ID 列表，用于维护所有项目

	Group        *ViewGroup `json:"group,omitempty"`     // 分组规则
	GroupCreated int64      `json:"groupCreated"`        // 分组生成时间戳
	Groups       []*View    `json:"groups,omitempty"`    // 分组视图列表
	GroupItemIDs []string   `json:"groupItemIds"`        // 分组项目 ID 列表，用于维护分组中的所有项目
	GroupCalc    *GroupCalc `json:"groupCalc,omitempty"` // 分组计算规则
	GroupKey     *Key       `json:"groupKey,omitempty"`  // 分组字段
	GroupVal     *Value     `json:"groupVal,omitempty"`  // 分组值
	GroupFolded  bool       `json:"groupFolded"`         // 分组是否折叠
	GroupHidden  int        `json:"groupHidden"`         // 分组是否隐藏，0：显示，1：空白隐藏，2：手动隐藏
	GroupSort    int        `json:"groupSort"`           // 分组排序值，用于手动排序
}

func (view *View) IsGroupView() bool {
	return nil != view.Group && "" != view.Group.Field
}

// GetGroupValue 获取分组视图的分组值。
func (view *View) GetGroupValue() string {
	if nil == view.GroupVal {
		return ""
	}
	return view.GroupVal.String(false)
}

// GetGroupByID 获取指定分组 ID 的分组视图。
func (view *View) GetGroupByID(groupID string) *View {
	if nil == view.Groups {
		return nil
	}
	for _, group := range view.Groups {
		if group.ID == groupID {
			return group
		}
	}
	return nil
}

// GetGroupByGroupValue 获取指定分组值的分组视图。
func (view *View) GetGroupByGroupValue(groupVal string) *View {
	if nil == view.Groups {
		return nil
	}
	for _, group := range view.Groups {
		if group.GetGroupValue() == groupVal {
			return group
		}
	}
	return nil
}

// RemoveGroupByID 从分组视图列表中移除指定 ID 的分组视图。
func (view *View) RemoveGroupByID(groupID string) {
	if nil == view.Groups {
		return
	}
	for i, group := range view.Groups {
		if group.ID == groupID {
			view.Groups = append(view.Groups[:i], view.Groups[i+1:]...)
			return
		}
	}
}

// GetGroupKey 获取分组视图的分组字段。
func (view *View) GetGroupKey(attrView *AttributeView) (ret *Key) {
	if !view.IsGroupView() {
		return
	}

	for _, kv := range attrView.KeyValues {
		if kv.Key.ID == view.Group.Field {
			ret = kv.Key
			return
		}
	}
	return
}

// GroupCalc 描述了分组计算规则和结果的结构。
type GroupCalc struct {
	Field     string     `json:"field"` // 字段 ID
	FieldCalc *FieldCalc `json:"calc"`  // 计算规则和结果
}

// LayoutType 描述了视图布局类型。
type LayoutType string

const (
	LayoutTypeTable   LayoutType = "table"   // 属性视图类型 - 表格
	LayoutTypeGallery LayoutType = "gallery" // 属性视图类型 - 卡片
	LayoutTypeKanban  LayoutType = "kanban"  // 属性视图类型 - 看板
)

const (
	ViewDefaultPageSize = 50 // 视图默认分页大小
)

func NewTableView() *View {
	return &View{
		ID:         ast.NewNodeID(),
		Name:       GetAttributeViewI18n("table"),
		Filters:    []*ViewFilter{},
		Sorts:      []*ViewSort{},
		PageSize:   ViewDefaultPageSize,
		LayoutType: LayoutTypeTable,
		Table:      NewLayoutTable(),
	}
}

func NewTableViewWithBlockKey(blockKeyID string) (view *View, blockKey, selectKey *Key) {
	name := GetAttributeViewI18n("table")
	view = &View{
		ID:         ast.NewNodeID(),
		Name:       name,
		Filters:    []*ViewFilter{},
		Sorts:      []*ViewSort{},
		LayoutType: LayoutTypeTable,
		Table:      NewLayoutTable(),
		PageSize:   ViewDefaultPageSize,
	}
	blockKey = NewKey(blockKeyID, GetAttributeViewI18n("key"), "", KeyTypeBlock)
	view.Table.Columns = []*ViewTableColumn{{BaseField: &BaseField{ID: blockKeyID}}}

	selectKey = NewKey(ast.NewNodeID(), GetAttributeViewI18n("select"), "", KeyTypeSelect)
	view.Table.Columns = append(view.Table.Columns, &ViewTableColumn{BaseField: &BaseField{ID: selectKey.ID}})
	return
}

func NewGalleryView() (ret *View) {
	return &View{
		ID:         ast.NewNodeID(),
		Name:       GetAttributeViewI18n("gallery"),
		Filters:    []*ViewFilter{},
		Sorts:      []*ViewSort{},
		PageSize:   ViewDefaultPageSize,
		LayoutType: LayoutTypeGallery,
		Gallery:    NewLayoutGallery(),
	}
}

func NewKanbanView() (ret *View) {
	return &View{
		ID:         ast.NewNodeID(),
		Name:       GetAttributeViewI18n("kanban"),
		Filters:    []*ViewFilter{},
		Sorts:      []*ViewSort{},
		PageSize:   ViewDefaultPageSize,
		LayoutType: LayoutTypeKanban,
		Kanban:     NewLayoutKanban(),
	}
}

// Viewable 描述了视图的接口。
type Viewable interface {

	// GetType 获取视图的布局类型。
	GetType() LayoutType

	// GetID 获取视图的 ID。
	GetID() string

	// SetGroups 设置视图分组列表。
	SetGroups(viewables []Viewable)

	// SetGroupCalc 设置视图分组计算规则和结果。
	SetGroupCalc(group *GroupCalc)

	// GetGroupCalc 获取视图分组计算规则和结果。
	GetGroupCalc() *GroupCalc

	// SetGroupFolded 设置分组是否折叠。
	SetGroupFolded(folded bool)

	// GetGroupHidden 获取分组是否隐藏。
	// hidden 0：显示，1：空白隐藏，2：手动隐藏
	GetGroupHidden() int

	// SetGroupHidden 设置分组是否隐藏。
	// hidden 0：显示，1：空白隐藏，2：手动隐藏
	SetGroupHidden(hidden int)
}

func NewAttributeView(id string) (ret *AttributeView) {
	view, blockKey, selectKey := NewTableViewWithBlockKey(ast.NewNodeID())
	ret = &AttributeView{
		Spec:              CurrentSpec,
		ID:                id,
		KeyValues:         []*KeyValues{{Key: blockKey}, {Key: selectKey}},
		ViewID:            view.ID,
		Views:             []*View{view},
		RenderedViewables: map[string]Viewable{},
	}
	return
}

func GetAttributeViewName(avID string) (ret string, err error) {
	avJSONPath := GetAttributeViewDataPath(avID)
	if !filelock.IsExist(avJSONPath) {
		return
	}

	return GetAttributeViewNameByPath(avJSONPath)
}

func GetAttributeViewNameByPath(avJSONPath string) (ret string, err error) {
	data, err := filelock.ReadFile(avJSONPath)
	if err != nil {
		logging.LogErrorf("read attribute view [%s] failed: %s", avJSONPath, err)
		return
	}

	val := jsoniter.Get(data, "name")
	if nil == val || val.ValueType() == jsoniter.InvalidValue {
		return
	}
	ret = val.ToString()
	return
}

func IsAttributeViewExist(avID string) bool {
	avJSONPath := GetAttributeViewDataPath(avID)
	return filelock.IsExist(avJSONPath)
}

func ParseAttributeView(avID string) (ret *AttributeView, err error) {
	avJSONPath := GetAttributeViewDataPath(avID)
	if !filelock.IsExist(avJSONPath) {
		err = ErrViewNotFound
		return
	}

	data, readErr := filelock.ReadFile(avJSONPath)
	if nil != readErr {
		logging.LogErrorf("read attribute view [%s] failed: %s", avID, readErr)
		return
	}

	ret = &AttributeView{RenderedViewables: map[string]Viewable{}}
	if err = gulu.JSON.UnmarshalJSON(data, ret); err != nil {
		if strings.Contains(err.Error(), ".relation.contents of type av.Value") {
			mapAv := map[string]interface{}{}
			if err = gulu.JSON.UnmarshalJSON(data, &mapAv); err != nil {
				logging.LogErrorf("unmarshal attribute view [%s] failed: %s", avID, err)
				return
			}

			// v3.0.3 兼容之前旧版本，将 relation.contents[""] 转换为 null
			keyValues := mapAv["keyValues"]
			keyValuesMap := keyValues.([]interface{})
			for _, kv := range keyValuesMap {
				kvMap := kv.(map[string]interface{})
				if values := kvMap["values"]; nil != values {
					valuesMap := values.([]interface{})
					for _, v := range valuesMap {
						if vMap := v.(map[string]interface{}); nil != vMap["relation"] {
							vMap["relation"].(map[string]interface{})["contents"] = nil
						}
					}
				}
			}

			views := mapAv["views"]
			viewsMap := views.([]interface{})
			for _, view := range viewsMap {
				if table := view.(map[string]interface{})["table"]; nil != table {
					tableMap := table.(map[string]interface{})
					if filters := tableMap["filters"]; nil != filters {
						filtersMap := filters.([]interface{})
						for _, f := range filtersMap {
							if fMap := f.(map[string]interface{}); nil != fMap["value"] {
								if valueMap := fMap["value"].(map[string]interface{}); nil != valueMap["relation"] {
									valueMap["relation"].(map[string]interface{})["contents"] = nil
								}
							}
						}
					}
				}
			}

			data, err = gulu.JSON.MarshalJSON(mapAv)
			if err != nil {
				logging.LogErrorf("marshal attribute view [%s] failed: %s", avID, err)
				return
			}

			if err = gulu.JSON.UnmarshalJSON(data, ret); err != nil {
				logging.LogErrorf("unmarshal attribute view [%s] failed: %s", avID, err)
				return
			}
		} else {
			logging.LogErrorf("unmarshal attribute view [%s] failed: %s", avID, err)
			return
		}
	}
	return
}

func SaveAttributeView(av *AttributeView) (err error) {
	if "" == av.ID {
		err = errors.New("av id is empty")
		logging.LogErrorf("save attribute view failed: %s", err)
		return
	}

	// 做一些数据兼容和订正处理
	UpgradeSpec(av)

	// 值去重
	blockValues := av.GetBlockKeyValues()
	blockIDs := map[string]bool{}
	var duplicatedValueIDs []string
	for _, blockValue := range blockValues.Values {
		if !blockIDs[blockValue.BlockID] {
			blockIDs[blockValue.BlockID] = true
		} else {
			duplicatedValueIDs = append(duplicatedValueIDs, blockValue.ID)
		}
	}
	var tmp []*Value
	for _, blockValue := range blockValues.Values {
		if !gulu.Str.Contains(blockValue.ID, duplicatedValueIDs) {
			tmp = append(tmp, blockValue)
		}
	}
	blockValues.Values = tmp

	// 视图值去重
	for _, view := range av.Views {
		// 项目自定义排序去重
		view.ItemIDs = gulu.Str.RemoveDuplicatedElem(view.ItemIDs)

		// 分页大小
		if 1 > view.PageSize {
			view.PageSize = ViewDefaultPageSize
		}
	}

	// 清理渲染回填值
	for _, kv := range av.KeyValues {
		for i := len(kv.Values) - 1; i >= 0; i-- {
			if kv.Values[i].IsRenderAutoFill {
				kv.Values = append(kv.Values[:i], kv.Values[i+1:]...)
			}
		}
	}

	var data []byte
	if util.UseSingleLineSave {
		data, err = gulu.JSON.MarshalJSON(av)
	} else {
		data, err = gulu.JSON.MarshalIndentJSON(av, "", "\t")
	}
	if err != nil {
		logging.LogErrorf("marshal attribute view [%s] failed: %s", av.ID, err)
		return
	}

	avJSONPath := GetAttributeViewDataPath(av.ID)
	if err = filelock.WriteFile(avJSONPath, data); err != nil {
		logging.LogErrorf("save attribute view [%s] failed: %s", av.ID, err)
		return
	}

	if util.ExceedLargeFileWarningSize(len(data)) {
		msg := fmt.Sprintf(util.Langs[util.Lang][268], av.Name+" "+filepath.Base(avJSONPath), util.LargeFileWarningSize)
		util.PushErrMsg(msg, 7000)
	}
	return
}

func (av *AttributeView) GetView(viewID string) (ret *View) {
	for _, v := range av.Views {
		if v.ID == viewID {
			ret = v
			return
		}
	}
	return
}

func (av *AttributeView) GetCurrentView(viewID string) (ret *View, err error) {
	if "" != viewID {
		ret = av.GetView(viewID)
		if nil != ret {
			return
		}
	}

	for _, v := range av.Views {
		if v.ID == av.ViewID {
			ret = v
			return
		}
	}

	if 1 > len(av.Views) {
		err = ErrViewNotFound
		return
	}
	ret = av.Views[0]
	return
}

func (av *AttributeView) ExistBoundBlock(nodeID string) bool {
	for _, blockVal := range av.GetBlockKeyValues().Values {
		if blockVal.Block.ID == nodeID {
			return true
		}
	}
	return false
}

func (av *AttributeView) GetBlockValueByBoundID(nodeID string) *Value {
	for _, kv := range av.KeyValues {
		if KeyTypeBlock == kv.Key.Type {
			for _, v := range kv.Values {
				if v.Block.ID == nodeID {
					return v
				}
			}
		}
	}
	return nil
}

func (av *AttributeView) GetValue(keyID, itemID string) (ret *Value) {
	for _, kv := range av.KeyValues {
		if kv.Key.ID == keyID {
			for _, v := range kv.Values {
				if v.BlockID == itemID {
					ret = v
					return
				}
			}
		}
	}
	return
}

func (av *AttributeView) GetKey(keyID string) (ret *Key, err error) {
	for _, kv := range av.KeyValues {
		if kv.Key.ID == keyID {
			ret = kv.Key
			return
		}
	}
	err = ErrKeyNotFound
	return
}

func (av *AttributeView) GetBlockKeyValues() (ret *KeyValues) {
	for _, kv := range av.KeyValues {
		if KeyTypeBlock == kv.Key.Type {
			ret = kv
			return
		}
	}
	return
}

func (av *AttributeView) GetBlockValue(itemID string) (ret *Value) {
	for _, kv := range av.KeyValues {
		if KeyTypeBlock == kv.Key.Type && 0 < len(kv.Values) {
			for _, v := range kv.Values {
				if v.BlockID == itemID {
					ret = v
					return
				}
			}
		}
	}
	return
}

func (av *AttributeView) GetKeyValues(keyID string) (ret *KeyValues, err error) {
	for _, kv := range av.KeyValues {
		if kv.Key.ID == keyID {
			ret = kv
			return
		}
	}
	err = ErrKeyNotFound
	return
}

func (av *AttributeView) GetBlockKey() (ret *Key) {
	for _, kv := range av.KeyValues {
		if KeyTypeBlock == kv.Key.Type {
			ret = kv.Key
			return
		}
	}
	return
}

func (av *AttributeView) Clone() (ret *AttributeView) {
	ret = &AttributeView{}
	data, err := gulu.JSON.MarshalJSON(av)
	if err != nil {
		logging.LogErrorf("marshal attribute view [%s] failed: %s", av.ID, err)
		return nil
	}
	if err = gulu.JSON.UnmarshalJSON(data, ret); err != nil {
		logging.LogErrorf("unmarshal attribute view [%s] failed: %s", av.ID, err)
		return nil
	}

	ret.ID = ast.NewNodeID()
	if 1 > len(ret.Views) {
		logging.LogErrorf("attribute view [%s] has no views", av.ID)
		return nil
	}

	var oldKeyIDs []string
	keyIDMap := map[string]string{}
	for _, kv := range ret.KeyValues {
		newID := ast.NewNodeID()
		keyIDMap[kv.Key.ID] = newID
		oldKeyIDs = append(oldKeyIDs, kv.Key.ID)
		kv.Key.ID = newID
		kv.Values = []*Value{}

		if KeyTypeRelation == kv.Key.Type {
			// 断开关联
			kv.Key.Relation.IsTwoWay = false
			kv.Key.Relation.AvID = ""
			kv.Key.Relation.BackKeyID = ""
		}
	}

	oldKeyIDs = gulu.Str.RemoveDuplicatedElem(oldKeyIDs)
	sorts := map[string]int{}
	for i, k := range ret.KeyIDs {
		sorts[k] = i
	}
	sort.Slice(oldKeyIDs, func(i, j int) bool {
		return sorts[oldKeyIDs[i]] < sorts[oldKeyIDs[j]]
	})

	for _, view := range ret.Views {
		view.ID = ast.NewNodeID()

		for _, f := range view.Filters {
			f.Column = keyIDMap[f.Column]
		}
		for _, s := range view.Sorts {
			s.Column = keyIDMap[s.Column]
		}

		if nil != view.Group {
			view.Group.Field = keyIDMap[view.Group.Field]
		}

		switch view.LayoutType {
		case LayoutTypeTable:
			view.Table.ID = ast.NewNodeID()
			for _, column := range view.Table.Columns {
				column.ID = keyIDMap[column.ID]
			}
		case LayoutTypeGallery:
			view.Gallery.ID = ast.NewNodeID()
			for _, cardField := range view.Gallery.CardFields {
				cardField.ID = keyIDMap[cardField.ID]
			}
		case LayoutTypeKanban:
			view.Kanban.ID = ast.NewNodeID()
			for _, field := range view.Kanban.Fields {
				field.ID = keyIDMap[field.ID]
			}
		}
		view.ItemIDs = []string{}
	}
	ret.ViewID = ret.Views[0].ID

	ret.KeyIDs = nil
	for _, oldKeyID := range oldKeyIDs {
		newKeyID := keyIDMap[oldKeyID]
		ret.KeyIDs = append(ret.KeyIDs, newKeyID)
	}
	return
}

func GetAttributeViewDataPath(avID string) (ret string) {
	av := filepath.Join(util.DataDir, "storage", "av")
	ret = filepath.Join(av, avID+".json")
	if !gulu.File.IsDir(av) {
		if err := os.MkdirAll(av, 0755); err != nil {
			logging.LogErrorf("create attribute view dir failed: %s", err)
			return
		}
	}
	return
}

func GetAttributeViewI18n(key string) string {
	return util.AttrViewLangs[util.Lang][key].(string)
}

var (
	ErrViewNotFound    = errors.New("view not found")
	ErrKeyNotFound     = errors.New("key not found")
	ErrWrongLayoutType = errors.New("wrong layout type")
)

const (
	NodeAttrNameAvs        = "custom-avs"          // 用于标记块所属的属性视图，逗号分隔 av id
	NodeAttrView           = "custom-sy-av-view"   // 用于标记块所属的属性视图视图 view id Database block support specified view https://github.com/siyuan-note/siyuan/issues/10443
	NodeAttrViewStaticText = "custom-sy-av-s-text" // 用于标记块所属的属性视图静态文本 Database-bound block primary key supports setting static anchor text https://github.com/siyuan-note/siyuan/issues/10049

	NodeAttrViewNames = "av-names" // 用于临时标记块所属的属性视图名称，空格分隔
)
