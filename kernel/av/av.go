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
	"bytes"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/88250/gulu"
	"github.com/88250/lute/ast"
	"github.com/goccy/go-json"
	jsoniter "github.com/json-iterator/go"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// AttributeView 描述了属性视图的结构。
type AttributeView struct {
	Spec              int                `json:"spec"`                        // 格式版本
	ID                string             `json:"id"`                          // 属性视图 ID
	Name              string             `json:"name"`                        // 属性视图名称
	KeyValues         []*KeyValues       `json:"keyValues"`                   // 属性视图属性键值
	KeyIDs            []string           `json:"keyIDs"`                      // 属性视图属性键 ID，用于排序
	ViewID            string             `json:"viewID"`                      // 当前视图 ID
	Views             []*View            `json:"views"`                       // 视图
	NewItemTemplates  []*NewItemTemplate `json:"newItemTemplates,omitempty"`  // 新增条目模板
	DefaultTemplateID string             `json:"defaultTemplateID,omitempty"` // 默认新增条目模板 ID

	RenderedViewables map[string]Viewable `json:"-"` // 已经渲染好的视图
}

// NewItemTargetType 描述新增条目模板创建的目标类型。
type NewItemTargetType string

const (
	NewItemTargetDetached NewItemTargetType = "detached"
	NewItemTargetDocument NewItemTargetType = "document"
)

// NewItemSaveLocation 描述文档类型模板覆盖全局新建文档位置后的保存位置。
// nil 表示继承全局配置，非 nil 且 BoxID 为空表示使用当前数据库实例所在笔记本。
type NewItemSaveLocation struct {
	BoxID        string `json:"boxID,omitempty"`
	PathTemplate string `json:"pathTemplate"`
}

// NewItemFieldValueMode 描述新增条目模板字段默认值的填充方式。
type NewItemFieldValueMode string

const (
	NewItemFieldValueStatic      NewItemFieldValueMode = "static"
	NewItemFieldValueCurrentTime NewItemFieldValueMode = "currentTime"
)

// NewItemFieldValue 描述新增条目模板中的一个字段默认值。
type NewItemFieldValue struct {
	Mode  NewItemFieldValueMode `json:"mode"`
	Value *Value                `json:"value,omitempty"`
}

// NewItemTemplate 描述数据库新增条目时使用的模板。
type NewItemTemplate struct {
	ID                  string                        `json:"id"`
	Name                string                        `json:"name"`
	Icon                string                        `json:"icon,omitempty"`
	TargetType          NewItemTargetType             `json:"targetType"`
	PrimaryKeyTemplate  string                        `json:"primaryKeyTemplate,omitempty"`
	FieldValues         map[string]*NewItemFieldValue `json:"fieldValues,omitempty"`
	SaveLocation        *NewItemSaveLocation          `json:"saveLocation,omitempty"`
	ContentTemplatePath string                        `json:"contentTemplatePath,omitempty"`
}

// NewItemTemplatesConfig 描述一次完整的新增条目模板配置修改。
type NewItemTemplatesConfig struct {
	Templates         []*NewItemTemplate `json:"templates"`
	DefaultTemplateID string             `json:"defaultTemplateID,omitempty"`
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

// ViewData 用于序列化视图数据到前端。
type ViewData struct {
	ID               string     `json:"id"`
	Icon             string     `json:"icon"`
	Name             string     `json:"name"`
	Desc             string     `json:"desc"`
	HideAttrViewName bool       `json:"hideAttrViewName"`
	Type             LayoutType `json:"type"`
	PageSize         int        `json:"pageSize"`
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
		Filters:    []*ViewFilter{{Combination: FilterCombinationAnd}},
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
		Filters:    []*ViewFilter{{Combination: FilterCombinationAnd}},
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
		Filters:    []*ViewFilter{{Combination: FilterCombinationAnd}},
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
		Filters:    []*ViewFilter{{Combination: FilterCombinationAnd}},
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
	// 通过 fallback 查找 AV 定义的真实路径（普通 box 全局，加密笔记本笔记本级）
	avJSONPath, boxID := FindAttributeViewPath(avID)
	if avJSONPath == "" {
		avJSONPath = GetAttributeViewDataPath(avID)
		boxID = ""
	}
	if !filelock.IsExist(avJSONPath) {
		return
	}

	return getAttributeViewNameByPathInBox(avJSONPath, boxID)
}

func getAttributeViewNameByPathInBox(avJSONPath, boxID string) (ret string, err error) {
	data, err := filelock.ReadFile(avJSONPath)
	if err != nil {
		logging.LogErrorf("read attribute view [%s] failed: %s", avJSONPath, err)
		return
	}
	if boxID != "" {
		avID := strings.TrimSuffix(filepath.Base(avJSONPath), filepath.Ext(avJSONPath))
		plain, decErr := decryptAVData(boxID, avID, data)
		if decErr != nil {
			logging.LogErrorf("decrypt attribute view [%s] failed: %s", avJSONPath, decErr)
			return "", decErr
		}
		data = plain
	}

	val := jsoniter.Get(data, "name")
	if nil == val || val.ValueType() == jsoniter.InvalidValue {
		return
	}
	ret = val.ToString()
	return
}

// GetAttributeViewNameByPath 从指定路径读取 AV 名称（不加密，普通 box 兼容入口）。
func GetAttributeViewNameByPath(avJSONPath string) (ret string, err error) {
	return getAttributeViewNameByPathInBox(avJSONPath, "")
}

// GetAttributeViewNameInBox 获取指定笔记本中的数据库名称。
func GetAttributeViewNameInBox(avID, boxID string) (ret string, err error) {
	avJSONPath, _ := FindAttributeViewPathInBox(avID, boxID)
	if avJSONPath == "" {
		return
	}
	return getAttributeViewNameByPathInBox(avJSONPath, boxID)
}

func GetAttributeViewContent(avID string) (content string) {
	if "" == avID {
		return
	}

	attrView, err := ParseAttributeView(avID)
	if err != nil {
		logging.LogErrorf("parse attribute view [%s] failed: %s", avID, err)
		return
	}
	return getAttributeViewContent0(attrView)
}

func GetAttributeViewContentByPath(avJSONPath string) (content string) {
	attrView, err := ParseAttributeViewByPath(avJSONPath)
	if err != nil {
		logging.LogErrorf("parse attribute view [%s] failed: %s", avJSONPath, err)
		return
	}
	return getAttributeViewContent0(attrView)
}

func getAttributeViewContent0(attrView *AttributeView) (content string) {
	buf := bytes.Buffer{}
	buf.WriteString(attrView.Name)
	buf.WriteByte(' ')
	for _, v := range attrView.Views {
		buf.WriteString(v.Name)
		buf.WriteByte(' ')
	}

	for _, keyValues := range attrView.KeyValues {
		buf.WriteString(keyValues.Key.Name)
		buf.WriteByte(' ')
		for _, value := range keyValues.Values {
			if nil != value {
				buf.WriteString(value.String(true))
				buf.WriteByte(' ')
			}
		}
	}

	content = strings.TrimSpace(buf.String())
	return
}

func IsAttributeViewExist(avID string) bool {
	// 通过 fallback 查找（普通 box 全局，加密笔记本笔记本级）
	avJSONPath, _ := FindAttributeViewPath(avID)
	if avJSONPath == "" {
		avJSONPath = GetAttributeViewDataPath(avID)
	}
	return filelock.IsExist(avJSONPath)
}

func ParseAttributeView(avID string) (ret *AttributeView, err error) {
	if !ast.IsNodeIDPattern(avID) {
		err = ErrInvalidAttributeViewID
		return
	}

	// 加密笔记本的 AV 定义存笔记本级路径，通过 fallback 自动查找并解密
	avJSONPath, boxID := FindAttributeViewPath(avID)
	if avJSONPath == "" {
		// 文件不存在，可能是首次创建，按全局路径返回（由调用方处理）
		avJSONPath = GetAttributeViewDataPath(avID)
		return parseAttributeViewByPathInBox(avJSONPath, "")
	}
	if boxID != "" {
		SetAVBoxID(avID, boxID)
	}
	return parseAttributeViewByPathInBox(avJSONPath, boxID)
}

func ParseAttributeViewInBox(avID, boxID string) (ret *AttributeView, err error) {
	if !ast.IsNodeIDPattern(avID) {
		err = ErrInvalidAttributeViewID
		return
	}
	if boxID != "" && !ast.IsNodeIDPattern(boxID) {
		err = ErrInvalidBoxID
		return
	}

	avJSONPath, avBoxID := FindAttributeViewPathInBox(avID, boxID)
	if avJSONPath == "" {
		avJSONPath = attributeViewDataPathByBox(avID, boxID)
		avBoxID = boxID
	} else {
		// 只在文件确实存在于该 box 内时才设置映射，避免错误 boxID 污染后续路由
		if boxID != "" {
			SetAVBoxID(avID, boxID)
		}
	}
	return parseAttributeViewByPathInBox(avJSONPath, avBoxID)
}

func ParseAttributeViewByPath(avJSONPath string) (ret *AttributeView, err error) {
	return parseAttributeViewByPathInBox(avJSONPath, avBoxIDFromPath(avJSONPath))
}

func parseAttributeViewByPathInBox(avJSONPath, boxID string) (ret *AttributeView, err error) {
	if !filelock.IsExist(avJSONPath) {
		err = ErrViewNotFound
		return
	}

	avID := filepath.Base(avJSONPath)
	avID = strings.TrimSuffix(avID, filepath.Ext(avID))

	var data []byte
	if cached, ok := cache.GetAVDataInBox(avID, boxID); ok {
		data = cached
	} else {
		var readErr error
		data, readErr = filelock.ReadFile(avJSONPath)
		if nil != readErr {
			logging.LogErrorf("read attribute view [%s] failed: %s", avID, readErr)
			return
		}
		// 加密笔记本的 AV 定义是密文，按路径反查 boxID 后解密
		if boxID != "" {
			data, readErr = decryptAVData(boxID, avID, data)
			if readErr != nil {
				logging.LogErrorf("decrypt attribute view [%s] failed: %s", avID, readErr)
				return
			}
		} else if util.IsCiphertext(data) {
			// 历史等无法取得 boxID/DEK 的全局路径上读到密文：无法解密，返回空内容而非按 JSON 解析报错。
			// 这会在加密笔记本的 AV 因路径迁移（同步、导入、历史布局）落到全局位置时发生。
			return
		}
		cache.SetAVDataInBox(avID, boxID, data)
	}

	ret = &AttributeView{RenderedViewables: map[string]Viewable{}}
	if err = json.Unmarshal(data, ret); err != nil {
		if strings.Contains(err.Error(), ".relation.contents of type av.Value") {
			mapAv := map[string]any{}
			if err = json.Unmarshal(data, &mapAv); err != nil {
				logging.LogErrorf("unmarshal attribute view [%s] failed: %s", avID, err)
				return
			}

			// v3.0.3 兼容之前旧版本，将 relation.contents[""] 转换为 null
			keyValues := mapAv["keyValues"]
			keyValuesMap := keyValues.([]any)
			for _, kv := range keyValuesMap {
				kvMap := kv.(map[string]any)
				if values := kvMap["values"]; nil != values {
					valuesMap := values.([]any)
					for _, v := range valuesMap {
						if vMap := v.(map[string]any); nil != vMap["relation"] {
							vMap["relation"].(map[string]any)["contents"] = nil
						}
					}
				}
			}

			views := mapAv["views"]
			viewsMap := views.([]any)
			for _, view := range viewsMap {
				if table := view.(map[string]any)["table"]; nil != table {
					tableMap := table.(map[string]any)
					if filters := tableMap["filters"]; nil != filters {
						filtersMap := filters.([]any)
						for _, f := range filtersMap {
							if fMap := f.(map[string]any); nil != fMap["value"] {
								if valueMap := fMap["value"].(map[string]any); nil != valueMap["relation"] {
									valueMap["relation"].(map[string]any)["contents"] = nil
								}
							}
						}
					}
				}
			}

			data, err = json.Marshal(mapAv)
			if err != nil {
				logging.LogErrorf("marshal attribute view [%s] failed: %s", avID, err)
				return
			}

			if err = json.Unmarshal(data, ret); err != nil {
				logging.LogErrorf("unmarshal attribute view [%s] failed: %s", avID, err)
				return
			}
		} else {
			logging.LogErrorf("unmarshal attribute view [%s] failed: %s", avID, err)
			return
		}
	}
	if nil == err {
		err = CheckSpec(ret)
	}
	return
}

func SaveAttributeView(av *AttributeView) (err error) {
	if !ast.IsNodeIDPattern(av.ID) {
		err = ErrInvalidAttributeViewID
		logging.LogErrorf("save attribute view failed: %s", err)
		return
	}

	// 做一些数据兼容和订正处理
	UpgradeSpec(av)

	// 值去重
	blockValues := av.GetBlockKeyValues()
	if nil != blockValues {
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
	}

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

	// 缓存与待写入数据一致时跳过落盘；缓存未命中时再读盘比对，避免无变更的重复写入
	// 通过 fallback 查找 AV 定义的实际路径（普通 box 全局，加密笔记本笔记本级）
	avJSONPath, avBoxID := FindAttributeViewPath(av.ID)
	if avJSONPath == "" {
		// 文件不存在（首次创建），使用全局路径，boxID 为空（普通 box）
		// 加密笔记本的首次创建由 handler 层通过 SetAVBoxID 预设路径
		avJSONPath = GetAttributeViewDataPath(av.ID)
	}
	if cachedData, ok := cache.GetAVDataInBox(av.ID, avBoxID); ok {
		if len(cachedData) == len(data) && bytes.Equal(cachedData, data) {
			return
		}
	} else {
		if diskData, readErr := filelock.ReadFile(avJSONPath); nil == readErr {
			// 加密笔记本的磁盘数据是密文，需先解密再比对
			if avBoxID != "" {
				diskData, _ = decryptAVData(avBoxID, av.ID, diskData)
			}
			if len(diskData) == len(data) && bytes.Equal(diskData, data) {
				cache.SetAVDataInBox(av.ID, avBoxID, data)
				return
			}
		}
	}

	// 加密笔记本的数据需加密后再写盘
	writeData := data
	if avBoxID != "" {
		writeData, err = encryptAVData(avBoxID, av.ID, data)
		if err != nil {
			logging.LogErrorf("encrypt attribute view [%s] failed: %s", av.ID, err)
			return
		}
	}
	// 确保目录存在（加密笔记本的笔记本级 AV 目录可能尚不存在）
	if err = os.MkdirAll(filepath.Dir(avJSONPath), 0755); nil != err {
		logging.LogErrorf("create attribute view dir [%s] failed: %s", filepath.Dir(avJSONPath), err)
		return
	}
	if err = util.WriteFileByMmap(avJSONPath, writeData); nil != err {
		if err = filelock.WriteFile(avJSONPath, writeData); nil != err {
			logging.LogErrorf("save attribute view [%s] failed: %s", av.ID, err)
			return
		}
	}

	cache.SetAVDataInBox(av.ID, avBoxID, data)

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
	templateIDMap := map[string]string{}
	for _, itemTemplate := range ret.NewItemTemplates {
		if nil == itemTemplate {
			continue
		}
		oldID := itemTemplate.ID
		itemTemplate.ID = ast.NewNodeID()
		templateIDMap[oldID] = itemTemplate.ID
	}
	ret.DefaultTemplateID = templateIDMap[ret.DefaultTemplateID]
	if 1 > len(ret.Views) {
		logging.LogErrorf("attribute view [%s] has no views", av.ID)
		return nil
	}

	var oldKeyIDs []string
	keyIDMap := map[string]string{}
	keyTypeMap := map[string]KeyType{}
	for _, kv := range ret.KeyValues {
		newID := ast.NewNodeID()
		keyIDMap[kv.Key.ID] = newID
		keyTypeMap[kv.Key.ID] = kv.Key.Type
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

	for _, itemTemplate := range ret.NewItemTemplates {
		if nil == itemTemplate {
			continue
		}
		fieldValues := map[string]*NewItemFieldValue{}
		for oldKeyID, fieldValue := range itemTemplate.FieldValues {
			newKeyID, ok := keyIDMap[oldKeyID]
			if !ok || KeyTypeRelation == keyTypeMap[oldKeyID] {
				continue
			}
			fieldValues[newKeyID] = fieldValue
		}
		if 0 == len(fieldValues) {
			itemTemplate.FieldValues = nil
		} else {
			itemTemplate.FieldValues = fieldValues
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

		remapFilterColumns(view.Filters, keyIDMap)
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
	if !ast.IsNodeIDPattern(avID) {
		return
	}

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
	ErrAttributeViewNotFound  = errors.New("attribute view not found")
	ErrInvalidAttributeViewID = errors.New("invalid attribute view id")
	ErrInvalidBoxID           = errors.New("invalid box id")
	ErrViewNotFound           = errors.New("view not found")
	ErrKeyNotFound            = errors.New("key not found")
	ErrWrongLayoutType        = errors.New("wrong layout type")
	ErrInvalidColumnAlign     = errors.New("invalid column align")
	ErrSpecTooNew             = errors.New("attribute view spec is too new")
	ErrFilterTooDeep          = errors.New("filter nesting depth exceeds the maximum allowed")
)

const (
	NodeAttrNameAvs        = "custom-avs"          // 用于标记块所属的属性视图，逗号分隔 av id
	NodeAttrView           = "custom-sy-av-view"   // 用于标记块所属的属性视图视图 view id Database block support specified view https://github.com/siyuan-note/siyuan/issues/10443
	NodeAttrViewStaticText = "custom-sy-av-s-text" // 用于标记块所属的属性视图静态文本 Database-bound block primary key supports setting static anchor text https://github.com/siyuan-note/siyuan/issues/10049

	NodeAttrViewNames = "av-names" // 用于临时标记块所属的属性视图名称，空格分隔
)
