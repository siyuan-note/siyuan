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

package sql

import (
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func RenderAttributeViewTable(attrView *av.AttributeView, view *av.View, query string) (ret *av.Table) {
	ret = &av.Table{
		BaseInstance: &av.BaseInstance{
			ID:               view.ID,
			Icon:             view.Icon,
			Name:             view.Name,
			Desc:             view.Desc,
			HideAttrViewName: view.HideAttrViewName,
			Filters:          view.Table.Filters,
			Sorts:            view.Table.Sorts,
		},
		Columns: []*av.TableColumn{},
		Rows:    []*av.TableRow{},
	}

	// 组装列
	for _, col := range view.Table.Columns {
		key, getErr := attrView.GetKey(col.ID)
		if nil != getErr {
			// 找不到字段则在视图中删除
			removeMissingField(attrView, view, col.ID)
			continue
		}

		ret.Columns = append(ret.Columns, &av.TableColumn{
			BaseInstanceField: &av.BaseInstanceField{
				ID:           key.ID,
				Name:         key.Name,
				Type:         key.Type,
				Icon:         key.Icon,
				Wrap:         col.Wrap,
				Hidden:       col.Hidden,
				Desc:         key.Desc,
				Options:      key.Options,
				NumberFormat: key.NumberFormat,
				Template:     key.Template,
				Relation:     key.Relation,
				Rollup:       key.Rollup,
				Date:         key.Date,
			},
			Width: col.Width,
			Pin:   col.Pin,
			Calc:  col.Calc,
		})
	}

	rowsValues := generateAttrViewItems(attrView) // 生成行
	filterNotFoundAttrViewItems(&rowsValues)      // 过滤掉不存在的行

	// 生成行单元格
	for rowID, rowValues := range rowsValues {
		var tableRow av.TableRow
		for _, col := range ret.Columns {
			var tableCell *av.TableCell
			for _, keyValues := range rowValues {
				if keyValues.Key.ID == col.ID {
					tableCell = &av.TableCell{
						BaseValue: &av.BaseValue{
							ID:        keyValues.Values[0].ID,
							Value:     keyValues.Values[0],
							ValueType: col.Type,
						},
					}
					break
				}
			}
			if nil == tableCell {
				tableCell = &av.TableCell{
					BaseValue: &av.BaseValue{
						ID:        ast.NewNodeID(),
						ValueType: col.Type,
					},
				}
			}
			tableRow.ID = rowID

			fillAttributeViewBaseValue(tableCell.BaseValue, col.ID, rowID, col.NumberFormat, col.Template)
			tableRow.Cells = append(tableRow.Cells, tableCell)
		}
		ret.Rows = append(ret.Rows, &tableRow)
	}

	// 批量获取块属性以提升性能
	var ialIDs []string
	for _, row := range ret.Rows {
		block := row.GetBlockValue()
		if nil != block && !block.IsDetached {
			ialIDs = append(ialIDs, row.ID)
		}
	}
	ials := BatchGetBlockAttrs(ialIDs)

	// 渲染自动生成的列值，比如关联列、汇总列、创建时间列和更新时间列
	avCache := map[string]*av.AttributeView{}
	avCache[attrView.ID] = attrView
	for _, row := range ret.Rows {
		for _, cell := range row.Cells {
			switch cell.ValueType {
			case av.KeyTypeBlock: // 对于主键可能需要填充静态锚文本 Database-bound block primary key supports setting static anchor text https://github.com/siyuan-note/siyuan/issues/10049
				if nil != cell.Value.Block {
					for k, v := range ials[row.ID] {
						if k == av.NodeAttrViewStaticText+"-"+attrView.ID {
							cell.Value.Block.Content = v
							break
						}
					}
				}
			case av.KeyTypeRollup: // 渲染汇总列
				rollupKey, _ := attrView.GetKey(cell.Value.KeyID)
				if nil == rollupKey || nil == rollupKey.Rollup {
					break
				}

				relKey, _ := attrView.GetKey(rollupKey.Rollup.RelationKeyID)
				if nil == relKey || nil == relKey.Relation {
					break
				}

				relVal := attrView.GetValue(relKey.ID, row.ID)
				if nil == relVal || nil == relVal.Relation {
					break
				}

				destAv := avCache[relKey.Relation.AvID]
				if nil == destAv {
					destAv, _ = av.ParseAttributeView(relKey.Relation.AvID)
					if nil != destAv {
						avCache[relKey.Relation.AvID] = destAv
					}
				}
				if nil == destAv {
					break
				}

				destKey, _ := destAv.GetKey(rollupKey.Rollup.KeyID)
				if nil == destKey {
					continue
				}

				for _, blockID := range relVal.Relation.BlockIDs {
					destVal := destAv.GetValue(rollupKey.Rollup.KeyID, blockID)
					if nil == destVal {
						if destAv.ExistBlock(blockID) { // 数据库中存在行但是列值不存在是数据未初始化，这里补一个默认值
							destVal = av.GetAttributeViewDefaultValue(ast.NewNodeID(), rollupKey.Rollup.KeyID, blockID, destKey.Type)
						}
						if nil == destVal {
							continue
						}
					}
					if av.KeyTypeNumber == destKey.Type {
						destVal.Number.Format = destKey.NumberFormat
						destVal.Number.FormatNumber()
					}

					cell.Value.Rollup.Contents = append(cell.Value.Rollup.Contents, destVal.Clone())
				}

				cell.Value.Rollup.RenderContents(rollupKey.Rollup.Calc, destKey)

				// 将汇总列的值保存到 rowsValues 中，后续渲染模板列的时候会用到，下同
				// Database table view template columns support reading relation, rollup, created and updated columns https://github.com/siyuan-note/siyuan/issues/10442
				keyValues := rowsValues[row.ID]
				keyValues = append(keyValues, &av.KeyValues{Key: rollupKey, Values: []*av.Value{{ID: cell.Value.ID, KeyID: rollupKey.ID, BlockID: row.ID, Type: av.KeyTypeRollup, Rollup: cell.Value.Rollup}}})
				rowsValues[row.ID] = keyValues
			case av.KeyTypeRelation: // 渲染关联列
				relKey, _ := attrView.GetKey(cell.Value.KeyID)
				if nil != relKey && nil != relKey.Relation {
					destAv := avCache[relKey.Relation.AvID]
					if nil == destAv {
						destAv, _ = av.ParseAttributeView(relKey.Relation.AvID)
						if nil != destAv {
							avCache[relKey.Relation.AvID] = destAv
						}
					}
					if nil != destAv {
						blocks := map[string]*av.Value{}
						blockValues := destAv.GetBlockKeyValues()
						if nil != blockValues {
							for _, blockValue := range blockValues.Values {
								blocks[blockValue.BlockID] = blockValue
							}
							for _, blockID := range cell.Value.Relation.BlockIDs {
								if val := blocks[blockID]; nil != val {
									cell.Value.Relation.Contents = append(cell.Value.Relation.Contents, val)
								}
							}
						}
					}
				}

				keyValues := rowsValues[row.ID]
				keyValues = append(keyValues, &av.KeyValues{Key: relKey, Values: []*av.Value{{ID: cell.Value.ID, KeyID: relKey.ID, BlockID: row.ID, Type: av.KeyTypeRelation, Relation: cell.Value.Relation}}})
				rowsValues[row.ID] = keyValues
			case av.KeyTypeCreated: // 渲染创建时间
				createdStr := row.ID[:len("20060102150405")]
				created, parseErr := time.ParseInLocation("20060102150405", createdStr, time.Local)
				if nil == parseErr {
					cell.Value.Created = av.NewFormattedValueCreated(created.UnixMilli(), 0, av.CreatedFormatNone)
					cell.Value.Created.IsNotEmpty = true
				} else {
					cell.Value.Created = av.NewFormattedValueCreated(time.Now().UnixMilli(), 0, av.CreatedFormatNone)
				}

				keyValues := rowsValues[row.ID]
				createdKey, _ := attrView.GetKey(cell.Value.KeyID)
				keyValues = append(keyValues, &av.KeyValues{Key: createdKey, Values: []*av.Value{{ID: cell.Value.ID, KeyID: createdKey.ID, BlockID: row.ID, Type: av.KeyTypeCreated, Created: cell.Value.Created}}})
				rowsValues[row.ID] = keyValues
			case av.KeyTypeUpdated: // 渲染更新时间
				ial := ials[row.ID]
				if nil == ial {
					ial = map[string]string{}
				}
				block := row.GetBlockValue()
				updatedStr := ial["updated"]
				if "" == updatedStr && nil != block {
					cell.Value.Updated = av.NewFormattedValueUpdated(block.Block.Updated, 0, av.UpdatedFormatNone)
					cell.Value.Updated.IsNotEmpty = true
				} else {
					updated, parseErr := time.ParseInLocation("20060102150405", updatedStr, time.Local)
					if nil == parseErr {
						cell.Value.Updated = av.NewFormattedValueUpdated(updated.UnixMilli(), 0, av.UpdatedFormatNone)
						cell.Value.Updated.IsNotEmpty = true
					} else {
						cell.Value.Updated = av.NewFormattedValueUpdated(time.Now().UnixMilli(), 0, av.UpdatedFormatNone)
					}
				}

				keyValues := rowsValues[row.ID]
				updatedKey, _ := attrView.GetKey(cell.Value.KeyID)
				keyValues = append(keyValues, &av.KeyValues{Key: updatedKey, Values: []*av.Value{{ID: cell.Value.ID, KeyID: updatedKey.ID, BlockID: row.ID, Type: av.KeyTypeUpdated, Updated: cell.Value.Updated}}})
				rowsValues[row.ID] = keyValues
			}
		}
	}

	// 最后单独渲染模板列，这样模板列就可以使用汇总、关联、创建时间和更新时间列的值了
	// Database table view template columns support reading relation, rollup, created and updated columns https://github.com/siyuan-note/siyuan/issues/10442

	var renderTemplateErr error
	for _, row := range ret.Rows {
		for _, cell := range row.Cells {
			switch cell.ValueType {
			case av.KeyTypeTemplate: // 渲染模板列
				keyValues := rowsValues[row.ID]
				ial := ials[row.ID]
				if nil == ial {
					ial = map[string]string{}
				}
				content, renderErr := RenderTemplateField(ial, keyValues, cell.Value.Template.Content)
				cell.Value.Template.Content = content
				if nil != renderErr {
					key, _ := attrView.GetKey(cell.Value.KeyID)
					keyName := ""
					if nil != key {
						keyName = key.Name
					}
					renderTemplateErr = fmt.Errorf("database [%s] template field [%s] rendering failed: %s", getAttrViewName(attrView), keyName, renderErr)
				}
			}
		}
	}
	if nil != renderTemplateErr {
		util.PushErrMsg(fmt.Sprintf(util.Langs[util.Lang][44], util.EscapeHTML(renderTemplateErr.Error())), 30000)
	}

	// 根据搜索条件过滤
	query = strings.TrimSpace(query)
	if "" != query {
		// 将连续空格转换为一个空格
		query = strings.Join(strings.Fields(query), " ")
		// 按空格分割关键字
		keywords := strings.Split(query, " ")
		// 使用 AND 逻辑 https://github.com/siyuan-note/siyuan/issues/11535
		var hitRows []*av.TableRow
		for _, row := range ret.Rows {
			hit := false
			for _, cell := range row.Cells {
				allKeywordsHit := true
				for _, keyword := range keywords {
					if !strings.Contains(strings.ToLower(cell.Value.String(true)), strings.ToLower(keyword)) {
						allKeywordsHit = false
						break
					}
				}
				if allKeywordsHit {
					hit = true
					break
				}
			}
			if hit {
				hitRows = append(hitRows, row)
			}
		}
		ret.Rows = hitRows
		if 1 > len(ret.Rows) {
			ret.Rows = []*av.TableRow{}
		}
	}

	// 自定义排序
	sortRowIDs := map[string]int{}
	if 0 < len(view.Table.RowIDs) {
		for i, rowID := range view.Table.RowIDs {
			sortRowIDs[rowID] = i
		}
	}

	sort.Slice(ret.Rows, func(i, j int) bool {
		iv := sortRowIDs[ret.Rows[i].ID]
		jv := sortRowIDs[ret.Rows[j].ID]
		if iv == jv {
			return ret.Rows[i].ID < ret.Rows[j].ID
		}
		return iv < jv
	})
	return
}
