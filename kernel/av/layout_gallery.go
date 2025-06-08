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

import "sort"

// LayoutGallery 描述了画廊布局的结构。
type LayoutGallery struct {
	Spec int    `json:"spec"` // 布局格式版本
	ID   string `json:"id"`   // 布局 ID

	CoverFrom           int                     `json:"coverFrom"`                     // 封面来源，0：无，1：内容图，2：资源字段
	CoverFromAssetKeyID string                  `json:"coverFromAssetKeyId,omitempty"` // 资源字段 ID，CoverFrom 为 2 时有效
	CardFields          []*ViewGalleryCardField `json:"fields"`                        // 画廊卡片字段
	CardIDs             []string                `json:"cardIds"`                       // 卡片 ID，用于自定义排序
	Filters             []*ViewFilter           `json:"filters"`                       // 过滤规则
	Sorts               []*ViewSort             `json:"sorts"`                         // 排序规则
	PageSize            int                     `json:"pageSize"`                      // 每页卡片数
}

// ViewGalleryCardField 描述了画廊卡片字段的结构。
type ViewGalleryCardField struct {
	ID string `json:"id"` // 字段 ID

	Hidden bool   `json:"hidden"`         // 是否隐藏
	Desc   string `json:"desc,omitempty"` // 字段描述
}

// Gallery 描述了画廊实例的结构。
type Gallery struct {
	ID               string          `json:"id"`               // 画廊布局 ID
	Icon             string          `json:"icon"`             // 画廊图标
	Name             string          `json:"name"`             // 画廊名称
	Desc             string          `json:"desc"`             // 画廊描述
	HideAttrViewName bool            `json:"hideAttrViewName"` // 是否隐藏属性视图名称
	Filters          []*ViewFilter   `json:"filters"`          // 过滤规则
	Sorts            []*ViewSort     `json:"sorts"`            // 排序规则
	Fields           []*GalleryField `json:"fields"`           // 画廊字段
	Cards            []*GalleryCard  `json:"cards"`            // 画廊卡片
	CardCount        int             `json:"cardCount"`        // 画廊总卡片数
	PageSize         int             `json:"pageSize"`         // 每页卡片数
}

// GalleryCard 描述了画廊实例卡片的结构。
type GalleryCard struct {
	ID     string               `json:"id"`     // 卡片 ID
	Values []*GalleryFieldValue `json:"values"` // 卡片字段值

	CoverURL string `json:"coverURL"` // 卡片封面超链接
}

// GalleryField 描述了画廊实例卡片字段的结构。
type GalleryField struct {
	ID     string  `json:"id"`     // 字段 ID
	Name   string  `json:"name"`   // 字段名
	Type   KeyType `json:"type"`   // 字段类型
	Icon   string  `json:"icon"`   // 字段图标
	Hidden bool    `json:"hidden"` // 是否隐藏
	Desc   string  `json:"desc"`   // 字段描述

	// 以下是某些字段类型的特有属性

	Options      []*SelectOption `json:"options,omitempty"`  // 选项字段表
	NumberFormat NumberFormat    `json:"numberFormat"`       // 数字字段格式化
	Template     string          `json:"template"`           // 模板字段内容
	Relation     *Relation       `json:"relation,omitempty"` // 关联字段
	Rollup       *Rollup         `json:"rollup,omitempty"`   // 汇总字段
	Date         *Date           `json:"date,omitempty"`     // 日期设置
}

// GalleryFieldValue 描述了画廊实例字段值的结构。
type GalleryFieldValue struct {
	ID        string  `json:"id"`        // 字段值 ID
	Value     *Value  `json:"value"`     // 字段值
	ValueType KeyType `json:"valueType"` // 字段值类型
}

func (card *GalleryCard) GetBlockValue() (ret *Value) {
	for _, v := range card.Values {
		if KeyTypeBlock == v.ValueType {
			ret = v.Value
			break
		}
	}
	return
}

func (gallery *Gallery) GetType() LayoutType {
	return LayoutTypeGallery
}

func (gallery *Gallery) GetID() string {
	return gallery.ID
}

func (gallery *Gallery) Sort(attrView *AttributeView) {
	if 1 > len(gallery.Sorts) {
		return
	}

	type FieldIndexSort struct {
		Index int
		Order SortOrder
	}

	var fieldIndexSorts []*FieldIndexSort
	for _, s := range gallery.Sorts {
		for i, c := range gallery.Fields {
			if c.ID == s.Column {
				fieldIndexSorts = append(fieldIndexSorts, &FieldIndexSort{Index: i, Order: s.Order})
				break
			}
		}
	}

	editedValCards := map[string]bool{}
	for i, card := range gallery.Cards {
		for _, fieldIndexSort := range fieldIndexSorts {
			val := gallery.Cards[i].Values[fieldIndexSort.Index].Value
			if KeyTypeCheckbox == val.Type {
				if block := card.GetBlockValue(); nil != block && block.IsEdited() {
					// 如果主键编辑过，则勾选框也算作编辑过，参与排序 https://github.com/siyuan-note/siyuan/issues/11016
					editedValCards[card.ID] = true
					break
				}
			}

			if val.IsEdited() {
				// 如果该卡片某字段的值已经编辑过，则该卡片可参与排序
				editedValCards[card.ID] = true
				break
			}
		}
	}

	// 将未编辑的卡片和已编辑的卡片分开排序
	var uneditedCards, editedCards []*GalleryCard
	for _, card := range gallery.Cards {
		if _, ok := editedValCards[card.ID]; ok {
			editedCards = append(editedCards, card)
		} else {
			uneditedCards = append(uneditedCards, card)
		}
	}

	sort.Slice(uneditedCards, func(i, j int) bool {
		val1 := uneditedCards[i].GetBlockValue()
		if nil == val1 {
			return true
		}
		val2 := uneditedCards[j].GetBlockValue()
		if nil == val2 {
			return false
		}
		return val1.CreatedAt < val2.CreatedAt
	})

	sort.Slice(editedCards, func(i, j int) bool {
		sorted := true
		for _, fieldIndexSort := range fieldIndexSorts {
			val1 := editedCards[i].Values[fieldIndexSort.Index].Value
			val2 := editedCards[j].Values[fieldIndexSort.Index].Value
			if nil == val1 || val1.IsEmpty() {
				if nil != val2 && !val2.IsEmpty() {
					return false
				}
				sorted = false
				continue
			} else {
				if nil == val2 || val2.IsEmpty() {
					return true
				}
			}

			result := val1.Compare(val2, attrView)
			if 0 == result {
				sorted = false
				continue
			}
			sorted = true

			if fieldIndexSort.Order == SortOrderAsc {
				return 0 > result
			}
			return 0 < result
		}

		if !sorted {
			key1 := editedCards[i].GetBlockValue()
			if nil == key1 {
				return false
			}
			key2 := editedCards[j].GetBlockValue()
			if nil == key2 {
				return false
			}
			return key1.CreatedAt < key2.CreatedAt
		}
		return false
	})

	// 将包含未编辑的卡片放在最后
	gallery.Cards = append(editedCards, uneditedCards...)
	if 1 > len(gallery.Cards) {
		gallery.Cards = []*GalleryCard{}
	}
}

func (gallery *Gallery) Filter(attrView *AttributeView) {
	if 1 > len(gallery.Filters) {
		return
	}

	var fieldIndexes []int
	for _, f := range gallery.Filters {
		for i, c := range gallery.Cards {
			if c.ID == f.Column {
				fieldIndexes = append(fieldIndexes, i)
				break
			}
		}
	}

	cards := []*GalleryCard{}
	attrViewCache := map[string]*AttributeView{}
	attrViewCache[attrView.ID] = attrView
	for _, card := range gallery.Cards {
		pass := true
		for j, index := range fieldIndexes {
			operator := gallery.Filters[j].Operator

			if nil == card.Values[index].Value {
				if FilterOperatorIsNotEmpty == operator {
					pass = false
				} else if FilterOperatorIsEmpty == operator {
					pass = true
					break
				}

				if KeyTypeText != card.Values[index].ValueType {
					pass = false
				}
				break
			}

			if !card.Values[index].Value.Filter(gallery.Filters[j], attrView, card.ID, &attrViewCache) {
				pass = false
				break
			}
		}
		if pass {
			cards = append(cards, card)
		}
	}
	gallery.Cards = cards
}
