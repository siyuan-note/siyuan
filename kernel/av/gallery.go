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
	ID               string         `json:"id"`               // 画廊布局 ID
	Icon             string         `json:"icon"`             // 画廊图标
	Name             string         `json:"name"`             // 画廊名称
	Desc             string         `json:"desc"`             // 画廊描述
	HideAttrViewName bool           `json:"hideAttrViewName"` // 是否隐藏属性视图名称
	Filters          []*ViewFilter  `json:"filters"`          // 过滤规则
	Sorts            []*ViewSort    `json:"sorts"`            // 排序规则
	Cards            []*GalleryCard `json:"cards"`            // 画廊卡片
	CardCount        int            `json:"cardCount"`        // 画廊总卡片数
	Limit            int            `json:"limit"`            // 每页卡片数
}

// GalleryCard 描述了画廊实例卡片的结构。
type GalleryCard struct {
	ID     string          `json:"id"`     // 卡片 ID
	Fields []*GalleryField `json:"fields"` // 卡片字段

	CoverURL string `json:"coverURL"` // 卡片封面超链接
}

// GalleryField 描述了画廊实例卡片字段的结构。
type GalleryField struct {
	ID        string  `json:"id"`        // 字段 ID
	Value     *Value  `json:"value"`     // 字段值
	ValueType KeyType `json:"valueType"` // 字段值类型

	// 以下是某些字段类型的特有属性

	Options      []*SelectOption `json:"options,omitempty"`  // 选项字段表
	NumberFormat NumberFormat    `json:"numberFormat"`       // 数字字段格式化
	Template     string          `json:"template"`           // 模板字段内容
	Relation     *Relation       `json:"relation,omitempty"` // 关联字段
	Rollup       *Rollup         `json:"rollup,omitempty"`   // 汇总字段
	Date         *Date           `json:"date,omitempty"`     // 日期设置
}
