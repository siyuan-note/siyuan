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
	"bytes"
	"strings"
	"time"

	"github.com/siyuan-note/siyuan/kernel/util"
)

type Sortable interface {
	SortRows(attrView *AttributeView)
}

type ViewSort struct {
	Column string    `json:"column"` // 列 ID
	Order  SortOrder `json:"order"`  // 排序顺序
}

type SortOrder string

const (
	SortOrderAsc  SortOrder = "ASC"
	SortOrderDesc SortOrder = "DESC"
)

func (value *Value) Compare(other *Value, attrView *AttributeView) int {
	switch value.Type {
	case KeyTypeBlock:
		if nil != value.Block && nil != other.Block {
			return strings.Compare(value.Block.Content, other.Block.Content)
		}
	case KeyTypeText:
		if nil != value.Text && nil != other.Text {
			if "" == value.Text.Content {
				if "" == other.Text.Content {
					return 0
				}
				return 1
			} else if "" == other.Text.Content {
				return -1
			}
			return strings.Compare(value.Text.Content, other.Text.Content)
		}
	case KeyTypeNumber:
		if nil != value.Number && nil != other.Number {
			if value.Number.IsNotEmpty {
				if !other.Number.IsNotEmpty {
					return -1
				}

				if value.Number.Content > other.Number.Content {
					return 1
				}
				if value.Number.Content < other.Number.Content {
					return -1
				}
				return 0
			} else {
				if !other.Number.IsNotEmpty {
					return 1
				}
				return 0
			}
		}
	case KeyTypeDate:
		if nil != value.Date && nil != other.Date {
			if value.Date.IsNotEmpty {
				if !other.Date.IsNotEmpty {
					return -1
				}

				valueContent := value.Date.Content
				otherContent := other.Date.Content

				if value.Date.IsNotTime {
					v := time.UnixMilli(valueContent)
					valueContent = time.Date(v.Year(), v.Month(), v.Day(), 0, 0, 0, 0, time.Local).UnixMilli()
				}
				if other.Date.IsNotTime {
					o := time.UnixMilli(otherContent)
					otherContent = time.Date(o.Year(), o.Month(), o.Day(), 0, 0, 0, 0, time.Local).UnixMilli()
				}

				if valueContent > otherContent {
					return 1
				}
				if valueContent < otherContent {
					return -1
				}
				return 0
			} else {
				if !other.Date.IsNotEmpty {
					return 1
				}
				return 0
			}
		}
	case KeyTypeCreated:
		if nil != value.Created && nil != other.Created {
			if value.Created.Content > other.Created.Content {
				return 1
			}
			if value.Created.Content < other.Created.Content {
				return -1
			}
			return 0
		}
	case KeyTypeUpdated:
		if nil != value.Updated && nil != other.Updated {
			if value.Updated.Content > other.Updated.Content {
				return 1
			}
			if value.Updated.Content < other.Updated.Content {
				return -1
			}
			return 0
		}
	case KeyTypeSelect, KeyTypeMSelect:
		if nil != value.MSelect && nil != other.MSelect {
			// 按设置的选项顺序排序
			key, _ := attrView.GetKey(value.KeyID)
			optionSort := map[string]int{}
			if nil != key {
				for i, op := range key.Options {
					optionSort[op.Name] = i
				}
			}

			vLen := len(value.MSelect)
			oLen := len(other.MSelect)
			if vLen <= oLen {
				for i := 0; i < vLen; i++ {
					v := value.MSelect[i].Content
					o := other.MSelect[i].Content
					vSort := optionSort[v]
					oSort := optionSort[o]
					if vSort != oSort {
						return vSort - oSort
					}
					s := strings.Compare(v, o)
					if 0 != s {
						return s
					}
				}
				return 0
			} else {
				for i := 0; i < oLen; i++ {
					v := value.MSelect[i].Content
					o := other.MSelect[i].Content
					vSort := optionSort[v]
					oSort := optionSort[o]
					if vSort != oSort {
						return vSort - oSort
					}
					s := strings.Compare(v, o)
					if 0 != s {
						return s
					}
				}
				return 0
			}
		}
	case KeyTypeURL:
		if nil != value.URL && nil != other.URL {
			if "" == value.URL.Content {
				if "" == other.URL.Content {
					return 0
				}
				return 1
			} else if "" == other.URL.Content {
				return -1
			}
			return strings.Compare(value.URL.Content, other.URL.Content)
		}
	case KeyTypeEmail:
		if nil != value.Email && nil != other.Email {
			if "" == value.Email.Content {
				if "" == other.Email.Content {
					return 0
				}
				return 1
			} else if "" == other.Email.Content {
				return -1
			}
			return strings.Compare(value.Email.Content, other.Email.Content)
		}
	case KeyTypePhone:
		if nil != value.Phone && nil != other.Phone {
			if "" == value.Phone.Content {
				if "" == other.Phone.Content {
					return 0
				}
				return 1
			} else if "" == other.Phone.Content {
				return -1
			}
			return strings.Compare(value.Phone.Content, other.Phone.Content)
		}
	case KeyTypeMAsset:
		if nil != value.MAsset && nil != other.MAsset {
			var v1 string
			for _, v := range value.MAsset {
				v1 += v.Content
			}
			var v2 string
			for _, v := range other.MAsset {
				v2 += v.Content
			}
			return strings.Compare(v1, v2)
		}
	case KeyTypeTemplate:
		if nil != value.Template && nil != other.Template {
			v1, ok1 := util.Convert2Float(value.Template.Content)
			v2, ok2 := util.Convert2Float(other.Template.Content)
			if ok1 && ok2 {
				if v1 > v2 {
					return 1
				}
				if v1 < v2 {
					return -1
				}
				return 0
			}
			return strings.Compare(value.Template.Content, other.Template.Content)
		}
	case KeyTypeCheckbox:
		if nil != value.Checkbox && nil != other.Checkbox {
			if value.Checkbox.Checked && !other.Checkbox.Checked {
				return 1
			}
			if !value.Checkbox.Checked && other.Checkbox.Checked {
				return -1
			}
			return 0
		}
	case KeyTypeRelation:
		if nil != value.Relation && nil != other.Relation {
			if 1 < len(value.Relation.Contents) && 1 < len(other.Relation.Contents) && KeyTypeNumber == value.Relation.Contents[0].Type && KeyTypeNumber == other.Relation.Contents[0].Type {
				v1, ok1 := util.Convert2Float(value.Relation.Contents[0].String(false))
				v2, ok2 := util.Convert2Float(other.Relation.Contents[0].String(false))
				if ok1 && ok2 {
					if v1 > v2 {
						return 1
					}
					if v1 < v2 {
						return -1
					}
					return 0
				}
			}

			vContentBuf := bytes.Buffer{}
			for _, c := range value.Relation.Contents {
				vContentBuf.WriteString(c.String(true))
				vContentBuf.WriteByte(' ')
			}
			vContent := strings.TrimSpace(vContentBuf.String())
			oContentBuf := bytes.Buffer{}
			for _, c := range other.Relation.Contents {
				oContentBuf.WriteString(c.String(true))
				oContentBuf.WriteByte(' ')
			}
			oContent := strings.TrimSpace(oContentBuf.String())
			return strings.Compare(vContent, oContent)
		}
	case KeyTypeRollup:
		if nil != value.Rollup && nil != other.Rollup {
			if 1 < len(value.Rollup.Contents) && 1 < len(other.Rollup.Contents) && KeyTypeNumber == value.Rollup.Contents[0].Type && KeyTypeNumber == other.Rollup.Contents[0].Type {
				v1, ok1 := util.Convert2Float(value.Rollup.Contents[0].String(false))
				v2, ok2 := util.Convert2Float(other.Rollup.Contents[0].String(false))
				if ok1 && ok2 {
					if v1 > v2 {
						return 1
					}
					if v1 < v2 {
						return -1
					}
					return 0
				}
			}

			vContentBuf := bytes.Buffer{}
			for _, c := range value.Rollup.Contents {
				vContentBuf.WriteString(c.String(true))
				vContentBuf.WriteByte(' ')
			}
			vContent := strings.TrimSpace(vContentBuf.String())
			oContentBuf := bytes.Buffer{}
			for _, c := range other.Rollup.Contents {
				oContentBuf.WriteString(c.String(true))
				oContentBuf.WriteByte(' ')
			}
			oContent := strings.TrimSpace(oContentBuf.String())
			return strings.Compare(vContent, oContent)
		}
	}
	return 0
}
