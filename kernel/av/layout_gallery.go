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

// LayoutGallery 描述了卡片布局的结构。
type LayoutGallery struct {
	*BaseLayout

	CoverFrom           CoverFrom       `json:"coverFrom"`                     // 封面来源，0：无，1：内容图，2：资源字段
	CoverFromAssetKeyID string          `json:"coverFromAssetKeyID,omitempty"` // 资源字段 ID，CoverFrom 为 2 时有效
	CardAspectRatio     CardAspectRatio `json:"cardAspectRatio"`               // 卡片宽高比
	CardSize            CardSize        `json:"cardSize"`                      // 卡片大小，0：小卡片，1：中卡片，2：大卡片
	FitImage            bool            `json:"fitImage"`                      // 是否适应封面图片大小
	DisplayFieldName    bool            `json:"displayFieldName"`              // 是否显示字段名称

	CardFields []*ViewGalleryCardField `json:"fields"` // 卡片字段

	// TODO CardIDs 字段已经废弃，计划于 2026 年 6 月 30 日后删除 https://github.com/siyuan-note/siyuan/issues/15194
	//Deprecated
	CardIDs []string `json:"cardIds"` // 卡片 ID，用于自定义排序
}

func NewLayoutGallery() *LayoutGallery {
	return &LayoutGallery{
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

type CardAspectRatio int

const (
	CardAspectRatio16_9 CardAspectRatio = iota // 16:9
	CardAspectRatio9_16                        // 9:16
	CardAspectRatio4_3                         // 4:3
	CardAspectRatio3_4                         // 3:4
	CardAspectRatio3_2                         // 3:2
	CardAspectRatio2_3                         // 2:3
	CardAspectRatio1_1                         // 1:1
)

type CardSize int

const (
	CardSizeSmall  CardSize = iota // 小卡片
	CardSizeMedium                 // 中卡片
	CardSizeLarge                  // 大卡片
)

// CoverFrom 描述了卡片封面来源的枚举类型。
type CoverFrom int

const (
	CoverFromNone         CoverFrom = iota // 无封面
	CoverFromContentImage                  // 内容图
	CoverFromAssetField                    // 资源字段
	CoverFromContentBlock                  // 内容块
)

// ViewGalleryCardField 描述了卡片字段的结构。
type ViewGalleryCardField struct {
	*BaseField
}

// Gallery 描述了卡片视图实例的结构。
type Gallery struct {
	*BaseInstance

	CoverFrom           CoverFrom       `json:"coverFrom"`                     // 封面来源
	CoverFromAssetKeyID string          `json:"coverFromAssetKeyID,omitempty"` // 资源字段 ID，CoverFrom 为 CoverFromAssetField 时有效
	CardAspectRatio     CardAspectRatio `json:"cardAspectRatio"`               // 卡片宽高比
	CardSize            CardSize        `json:"cardSize"`                      // 卡片大小
	FitImage            bool            `json:"fitImage"`                      // 是否适应封面图片大小
	DisplayFieldName    bool            `json:"displayFieldName"`              // 是否显示字段名称
	Fields              []*GalleryField `json:"fields"`                        // 卡片字段
	Cards               []*GalleryCard  `json:"cards"`                         // 卡片
	CardCount           int             `json:"cardCount"`                     // 总卡片数
}

// GalleryCard 描述了卡片实例的结构。
type GalleryCard struct {
	ID     string               `json:"id"`     // 卡片 ID
	Values []*GalleryFieldValue `json:"values"` // 卡片字段值

	CoverURL     string `json:"coverURL"`     // 卡片封面超链接
	CoverContent string `json:"coverContent"` // 卡片封面文本内容
}

// GalleryField 描述了卡片实例字段的结构。
type GalleryField struct {
	*BaseInstanceField
}

// GalleryFieldValue 描述了卡片字段实例值的结构。
type GalleryFieldValue struct {
	*BaseValue
}

func (card *GalleryCard) GetID() string {
	return card.ID
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

func (card *GalleryCard) GetValues() (ret []*Value) {
	ret = []*Value{}
	for _, v := range card.Values {
		ret = append(ret, v.Value)
	}
	return
}

func (card *GalleryCard) GetValue(keyID string) (ret *Value) {
	for _, value := range card.Values {
		if nil != value.Value && keyID == value.Value.KeyID {
			ret = value.Value
			break
		}
	}
	return
}

func (gallery *Gallery) GetItems() (ret []Item) {
	ret = []Item{}
	for _, card := range gallery.Cards {
		ret = append(ret, card)
	}
	return
}

func (gallery *Gallery) SetItems(items []Item) {
	gallery.Cards = []*GalleryCard{}
	for _, item := range items {
		gallery.Cards = append(gallery.Cards, item.(*GalleryCard))
	}
}

func (gallery *Gallery) CountItems() int {
	return len(gallery.Cards)
}

func (gallery *Gallery) GetFields() (ret []Field) {
	ret = []Field{}
	for _, field := range gallery.Fields {
		ret = append(ret, field)
	}
	return ret
}

func (gallery *Gallery) GetField(id string) (ret Field, fieldIndex int) {
	for i, field := range gallery.Fields {
		if field.ID == id {
			return field, i
		}
	}
	return nil, -1
}

func (gallery *Gallery) GetValue(itemID, keyID string) (ret *Value) {
	for _, card := range gallery.Cards {
		if card.ID == itemID {
			return card.GetValue(keyID)
		}
	}
	return nil
}

func (gallery *Gallery) GetType() LayoutType {
	return LayoutTypeGallery
}
