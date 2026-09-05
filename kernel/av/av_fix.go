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

package av

import (
	"time"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/util"
)

const (
	CurrentSpec   = 9
	PlainTextSpec = 8
	RichTextSpec  = 9
)

const MaxFilterNestingDepth = 3

func UpgradeSpec(av *AttributeView) {
	if CurrentSpec <= av.Spec {
		return
	}

	upgradeSpec1(av)
	upgradeSpec2(av)
	upgradeSpec3(av)
	upgradeSpec4(av)
	upgradeSpec5(av)
	upgradeSpec6(av)
	upgradeSpec7(av)
	upgradeSpec8(av)
	upgradeSpec9(av)
}

func CheckSpec(av *AttributeView) (err error) {
	if CurrentSpec < av.Spec {
		logging.LogErrorf("attribute view [%s] spec [%d] is newer than current [%d]", av.ID, av.Spec, CurrentSpec)
		err = ErrSpecTooNew
		return
	}
	if av.Spec < RichTextSpec && av.HasRichText() {
		logging.LogErrorf("attribute view [%s] rich text requires spec [%d], current is [%d]", av.ID, RichTextSpec, av.Spec)
		err = ErrRichTextSpecMismatch
		return
	}
	return
}

// upgradeSpec9 仅在首次保存富文本值时升级，避免纯文本数据库因为在新版中打开而失去旧版兼容性。
func upgradeSpec9(av *AttributeView) {
	if RichTextSpec <= av.Spec || !av.HasRichText() {
		return
	}

	av.Spec = RichTextSpec
}

// HasRichText 返回属性视图是否包含富文本值。
func (av *AttributeView) HasRichText() bool {
	if nil == av {
		return false
	}
	found := false
	av.visitPersistedValues(func(value *Value) {
		if nil != value.Text && value.Text.IsRich() {
			found = true
		}
	})
	return found
}

// NormalizeRichText 校验所有富文本载荷，并刷新对应的纯文本投影。
func (av *AttributeView) NormalizeRichText() (err error) {
	if nil == av {
		return
	}
	type normalizedText struct {
		value       *ValueText
		content     string
		richContent string
	}
	var normalized []normalizedText
	av.visitPersistedValues(func(value *Value) {
		if nil != err || nil == value.Text || !value.Text.IsRich() {
			return
		}
		rich := *value.Text.Rich
		var tree *parse.Tree
		if tree, err = NormalizeValueTextRich(&rich); nil == err {
			normalized = append(normalized, normalizedText{
				value:       value.Text,
				content:     valueTextRichPlainContent(tree),
				richContent: rich.Content,
			})
		}
	})
	if nil != err {
		return
	}
	for _, text := range normalized {
		text.value.Content = text.content
		text.value.Rich.Content = text.richContent
	}
	return
}

// upgradeSpec7 移除数据库级当前视图，当前视图由数据库块属性或调用上下文决定。
// https://github.com/siyuan-note/siyuan/issues/18539
func upgradeSpec7(av *AttributeView) {
	if 7 <= av.Spec {
		return
	}

	av.Spec = 7
}

// upgradeSpec8 初始化数据库级自定义选项颜色。
func upgradeSpec8(av *AttributeView) {
	if 8 <= av.Spec {
		return
	}

	av.Spec = 8
}

// upgradeSpec6 将卡片和看板的预设尺寸转换为可连续调节的实际宽度和宽高比。
func upgradeSpec6(av *AttributeView) {
	if 6 <= av.Spec {
		return
	}

	for _, view := range av.Views {
		if nil != view.Gallery {
			view.Gallery.CardWidth = CardWidthBySize(view.Gallery.CardSize)
			view.Gallery.CardAspectRatioValue = CardAspectRatioValueByPreset(view.Gallery.CardAspectRatio)
		}
		if nil != view.Kanban {
			view.Kanban.CardWidth = CardWidthBySize(view.Kanban.CardSize)
			view.Kanban.CardAspectRatioValue = CardAspectRatioValueByPreset(view.Kanban.CardAspectRatio)
		}
	}

	av.Spec = 6
}

// upgradeSpec5 将旧的扁平过滤规则数组包装为单个隐式 AND 根组，支持递归嵌套分组。
// 原有叶子条件一条不丢，整体作为根组的子节点保留。
func upgradeSpec5(av *AttributeView) {
	if 5 <= av.Spec {
		return
	}

	for _, view := range av.Views {
		if 1 == len(view.Filters) && nil != view.Filters[0] && view.Filters[0].IsGroup() {
			continue // 已经是根组形式，无需包装
		}
		// 收集非 nil 的原有条件
		var children []*ViewFilter
		for _, f := range view.Filters {
			if nil != f {
				children = append(children, f)
			}
		}
		// 包装成 AND 根组，原条件作为子节点（空时即为空根组）
		view.Filters = []*ViewFilter{{Combination: FilterCombinationAnd, Filters: children}}
	}

	av.Spec = 5
}

func upgradeSpec4(av *AttributeView) {
	if 4 <= av.Spec {
		return
	}

	for _, keyValues := range av.KeyValues {
		switch keyValues.Key.Type {
		case KeyTypeCreated:
			if nil == keyValues.Key.Created {
				keyValues.Key.Created = &Created{IncludeTime: true}
			}
		case KeyTypeUpdated:
			if nil == keyValues.Key.Updated {
				keyValues.Key.Updated = &Updated{IncludeTime: true}
			}
		}
	}

	av.Spec = 4
}

func upgradeSpec3(av *AttributeView) {
	if 3 <= av.Spec {
		return
	}

	// 将 view.table.rowIds 或 view.gallery.cardIds 复制到 view.itemIds
	for _, view := range av.Views {
		if 0 < len(view.ItemIDs) {
			continue
		}

		switch view.LayoutType {
		case LayoutTypeTable:
			if nil != view.Table {
				view.ItemIDs = view.Table.RowIDs
			}
		case LayoutTypeGallery:
			if nil != view.Gallery {
				view.ItemIDs = view.Gallery.CardIDs
			}
		}
	}

	av.Spec = 3
}

func upgradeSpec2(av *AttributeView) {
	if 2 <= av.Spec {
		return
	}

	// 如果存在 view.table.filters/sorts/pageSize 则复制覆盖到 view.filters/sorts/pageSize
	for _, view := range av.Views {
		if 1 > len(view.Filters) {
			view.Filters = []*ViewFilter{}
		}
		if 1 > len(view.Sorts) {
			view.Sorts = []*ViewSort{}
		}
		if 1 > view.PageSize {
			view.PageSize = ViewDefaultPageSize
		}

		if nil != view.Table {
			if 0 < len(view.Table.Filters) && 1 > len(view.Filters) {
				view.Filters = append(view.Filters, view.Table.Filters...)
			}
			if 0 < len(view.Table.Sorts) && 1 > len(view.Sorts) {
				view.Sorts = append(view.Sorts, view.Table.Sorts...)
			}
			if 0 < view.Table.PageSize {
				view.PageSize = view.Table.PageSize
			}
			view.Table.ShowIcon = true
		}

		// 清理过滤和排序规则中不存在的键
		tmpFilters := []*ViewFilter{}
		for _, f := range view.Filters {
			if k, _ := av.GetKey(f.Column); nil != k {
				tmpFilters = append(tmpFilters, f)
			}
		}
		view.Filters = tmpFilters

		tmpSorts := []*ViewSort{}
		for _, s := range view.Sorts {
			if k, _ := av.GetKey(s.Column); nil != k {
				tmpSorts = append(tmpSorts, s)
			}
		}
		view.Sorts = tmpSorts
	}

	av.Spec = 2
}

func upgradeSpec1(av *AttributeView) {
	if 1 <= av.Spec {
		return
	}

	now := util.CurrentTimeMillis()
	for _, kv := range av.KeyValues {
		switch kv.Key.Type {
		case KeyTypeBlock:
			// 补全 block 的创建时间和更新时间
			for _, v := range kv.Values {
				if 0 == v.Block.Created {
					logging.LogWarnf("block [%s] created time is empty", v.BlockID)
					if "" == v.BlockID {
						v.BlockID = ast.NewNodeID()
					}

					createdStr := v.BlockID[:len("20060102150405")]
					created, parseErr := time.ParseInLocation("20060102150405", createdStr, time.Local)
					if nil == parseErr {
						v.Block.Created = created.UnixMilli()
					} else {
						v.Block.Created = now
					}
				}
				if 0 == v.Block.Updated {
					logging.LogWarnf("block [%s] updated time is empty", v.BlockID)
					v.Block.Updated = v.Block.Created
				}
			}
		case KeyTypeNumber:
			for _, v := range kv.Values {
				if nil != v.Number && 0 != v.Number.Content && !v.Number.IsNotEmpty {
					v.Number.IsNotEmpty = true
				}
			}
		}

		for _, v := range kv.Values {
			if "" == kv.Key.ID {
				kv.Key.ID = ast.NewNodeID()
				for _, val := range kv.Values {
					val.KeyID = kv.Key.ID
				}
				if "" == v.KeyID {
					logging.LogWarnf("value [%s] key id is empty", v.ID)
					v.KeyID = kv.Key.ID
				}

				// 校验日期 IsNotEmpty
				if KeyTypeDate == kv.Key.Type {
					if nil != v.Date && 0 != v.Date.Content && !v.Date.IsNotEmpty {
						v.Date.IsNotEmpty = true
					}
				}

				// 校验数字 IsNotEmpty
				if KeyTypeNumber == kv.Key.Type {
					if nil != v.Number && 0 != v.Number.Content && !v.Number.IsNotEmpty {
						v.Number.IsNotEmpty = true
					}
				}

				// 清空关联实际值
				if KeyTypeRelation == kv.Key.Type {
					v.Relation.Contents = nil
				}

				// 清空汇总实际值
				if KeyTypeRollup == kv.Key.Type {
					v.Rollup.Contents = nil
				}

				for _, view := range av.Views {
					switch view.LayoutType {
					case LayoutTypeTable:
						for _, column := range view.Table.Columns {
							if "" == column.ID {
								column.ID = kv.Key.ID
								break
							}
						}
					}
				}
			}

			// 补全值的创建时间和更新时间
			if "" == v.ID {
				logging.LogWarnf("value id is empty")
				v.ID = ast.NewNodeID()
			}

			if 0 == v.CreatedAt {
				logging.LogWarnf("value [%s] created time is empty", v.ID)
				createdStr := v.ID[:len("20060102150405")]
				created, parseErr := time.ParseInLocation("20060102150405", createdStr, time.Local)
				if nil == parseErr {
					v.CreatedAt = created.UnixMilli()
				} else {
					v.CreatedAt = now
				}
			}

			if 0 == v.UpdatedAt {
				logging.LogWarnf("value [%s] updated time is empty", v.ID)
				v.UpdatedAt = v.CreatedAt
			}
		}
	}

	// 补全过滤规则 Value
	for _, view := range av.Views {
		if nil != view.Table {
			for _, f := range view.Table.Filters {
				if nil != f.Value {
					continue
				}

				if k, _ := av.GetKey(f.Column); nil != k {
					f.Value = &Value{Type: k.Type}
				}
			}
		}
	}

	av.Spec = 1
}
