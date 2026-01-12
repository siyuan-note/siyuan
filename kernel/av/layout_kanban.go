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

package av

import (
	"github.com/88250/lute/ast"
)

// LayoutKanban 描述了看板视图的结构。
type LayoutKanban struct {
	*BaseLayout

	CoverFrom           CoverFrom       `json:"coverFrom"`                     // 封面来源，0：无，1：内容图，2：资源字段
	CoverFromAssetKeyID string          `json:"coverFromAssetKeyID,omitempty"` // 资源字段 ID，CoverFrom 为 2 时有效
	CardAspectRatio     CardAspectRatio `json:"cardAspectRatio"`               // 卡片宽高比
	CardSize            CardSize        `json:"cardSize"`                      // 卡片大小，0：小卡片，1：中卡片，2：大卡片
	FitImage            bool            `json:"fitImage"`                      // 是否适应封面图片大小
	DisplayFieldName    bool            `json:"displayFieldName"`              // 是否显示字段名称

	FillColBackgroundColor bool `json:"fillColBackgroundColor"` // 是否填充列背景颜色

	Fields []*ViewKanbanField `json:"fields"` // 字段
}

func NewLayoutKanban() *LayoutKanban {
	return &LayoutKanban{
		BaseLayout: &BaseLayout{
			Spec:     0,
			ID:       ast.NewNodeID(),
			ShowIcon: true,
		},
		CoverFrom:       CoverFromContentImage,
		CardAspectRatio: CardAspectRatio16_9,
		CardSize:        CardSizeMedium,
	}
}

// ViewKanbanField 描述了看板字段的结构。
type ViewKanbanField struct {
	*BaseField
}

// Kanban 描述了看板视图实例的结构。
type Kanban struct {
	*BaseInstance

	CoverFrom              CoverFrom       `json:"coverFrom"`                     // 封面来源
	CoverFromAssetKeyID    string          `json:"coverFromAssetKeyID,omitempty"` // 资源字段 ID，CoverFrom 为 CoverFromAssetField 时有效
	CardAspectRatio        CardAspectRatio `json:"cardAspectRatio"`               // 卡片宽高比
	CardSize               CardSize        `json:"cardSize"`                      // 卡片大小
	FitImage               bool            `json:"fitImage"`                      // 是否适应封面图片大小
	DisplayFieldName       bool            `json:"displayFieldName"`              // 是否显示字段名称
	FillColBackgroundColor bool            `json:"fillColBackgroundColor"`        // 是否填充列背景颜色
	Fields                 []*KanbanField  `json:"fields"`                        // 卡片字段
	Cards                  []*KanbanCard   `json:"cards"`                         // 卡片
	CardCount              int             `json:"cardCount"`                     // 总卡片数
}

// KanbanCard 描述了看板实例卡片的结构。
type KanbanCard struct {
	ID     string              `json:"id"`     // 卡片 ID
	Values []*KanbanFieldValue `json:"values"` // 卡片字段值

	CoverURL     string `json:"coverURL"`     // 卡片封面超链接
	CoverContent string `json:"coverContent"` // 卡片封面文本内容
}

// KanbanField 描述了看板实例字段的结构。
type KanbanField struct {
	*BaseInstanceField
}

// KanbanFieldValue 描述了卡片字段实例值的结构。
type KanbanFieldValue struct {
	*BaseValue
}

func (card *KanbanCard) GetID() string {
	return card.ID
}

func (card *KanbanCard) GetBlockValue() (ret *Value) {
	for _, v := range card.Values {
		if KeyTypeBlock == v.ValueType {
			ret = v.Value
			break
		}
	}
	return
}

func (card *KanbanCard) GetValues() (ret []*Value) {
	ret = []*Value{}
	for _, v := range card.Values {
		ret = append(ret, v.Value)
	}
	return
}

func (card *KanbanCard) GetValue(keyID string) (ret *Value) {
	for _, value := range card.Values {
		if nil != value.Value && keyID == value.Value.KeyID {
			ret = value.Value
			break
		}
	}
	return
}

func (kanban *Kanban) GetItems() (ret []Item) {
	ret = []Item{}
	for _, card := range kanban.Cards {
		ret = append(ret, card)
	}
	return
}

func (kanban *Kanban) SetItems(items []Item) {
	kanban.Cards = []*KanbanCard{}
	for _, item := range items {
		kanban.Cards = append(kanban.Cards, item.(*KanbanCard))
	}
}

func (kanban *Kanban) CountItems() int {
	return len(kanban.Cards)
}

func (kanban *Kanban) GetFields() (ret []Field) {
	ret = []Field{}
	for _, field := range kanban.Fields {
		ret = append(ret, field)
	}
	return ret
}

func (kanban *Kanban) GetField(id string) (ret Field, fieldIndex int) {
	for i, field := range kanban.Fields {
		if field.ID == id {
			return field, i
		}
	}
	return nil, -1
}

func (kanban *Kanban) GetValue(itemID, keyID string) (ret *Value) {
	for _, card := range kanban.Cards {
		if card.ID == itemID {
			return card.GetValue(keyID)
		}
	}
	return nil
}

func (kanban *Kanban) GetType() LayoutType {
	return LayoutTypeKanban
}
