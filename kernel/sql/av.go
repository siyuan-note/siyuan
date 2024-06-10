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

package sql

import (
	"bytes"
	"fmt"
	"sort"
	"strings"
	"text/template"
	"time"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func RenderAttributeViewTable(attrView *av.AttributeView, view *av.View, query string,
	GetBlockAttrsWithoutWaitWriting func(id string) (ret map[string]string)) (ret *av.Table) {
	if nil == GetBlockAttrsWithoutWaitWriting {
		GetBlockAttrsWithoutWaitWriting = func(id string) (ret map[string]string) {
			ret = cache.GetBlockIAL(id)
			if nil == ret {
				ret = map[string]string{}
			}
			return
		}
	}

	ret = &av.Table{
		ID:               view.ID,
		Icon:             view.Icon,
		Name:             view.Name,
		HideAttrViewName: view.HideAttrViewName,
		Columns:          []*av.TableColumn{},
		Rows:             []*av.TableRow{},
		Filters:          view.Table.Filters,
		Sorts:            view.Table.Sorts,
	}

	// 组装列
	for _, col := range view.Table.Columns {
		key, getErr := attrView.GetKey(col.ID)
		if nil != getErr {
			logging.LogWarnf("get key [%s] failed: %s", col.ID, getErr)
			continue
		}

		ret.Columns = append(ret.Columns, &av.TableColumn{
			ID:           key.ID,
			Name:         key.Name,
			Type:         key.Type,
			Icon:         key.Icon,
			Options:      key.Options,
			NumberFormat: key.NumberFormat,
			Template:     key.Template,
			Relation:     key.Relation,
			Rollup:       key.Rollup,
			Date:         key.Date,
			Wrap:         col.Wrap,
			Hidden:       col.Hidden,
			Width:        col.Width,
			Pin:          col.Pin,
			Calc:         col.Calc,
		})
	}

	// 生成行
	rows := map[string][]*av.KeyValues{}
	for _, keyValues := range attrView.KeyValues {
		for _, val := range keyValues.Values {
			values := rows[val.BlockID]
			if nil == values {
				values = []*av.KeyValues{{Key: keyValues.Key, Values: []*av.Value{val}}}
			} else {
				values = append(values, &av.KeyValues{Key: keyValues.Key, Values: []*av.Value{val}})
			}
			rows[val.BlockID] = values
		}
	}

	// 过滤掉不存在的行
	var notFound []string
	for blockID, keyValues := range rows {
		blockValue := getRowBlockValue(keyValues)
		if nil == blockValue {
			notFound = append(notFound, blockID)
			continue
		}

		if blockValue.IsDetached {
			continue
		}

		if nil != blockValue.Block && "" == blockValue.Block.ID {
			notFound = append(notFound, blockID)
			continue
		}

		if nil == treenode.GetBlockTree(blockID) {
			notFound = append(notFound, blockID)
		}
	}
	for _, blockID := range notFound {
		delete(rows, blockID)
	}

	// 生成行单元格
	for rowID, row := range rows {
		var tableRow av.TableRow
		for _, col := range ret.Columns {
			var tableCell *av.TableCell
			for _, keyValues := range row {
				if keyValues.Key.ID == col.ID {
					tableCell = &av.TableCell{
						ID:        keyValues.Values[0].ID,
						Value:     keyValues.Values[0],
						ValueType: col.Type,
					}
					break
				}
			}
			if nil == tableCell {
				tableCell = &av.TableCell{
					ID:        ast.NewNodeID(),
					ValueType: col.Type,
				}
			}
			tableRow.ID = rowID

			switch tableCell.ValueType {
			case av.KeyTypeNumber: // 格式化数字
				if nil != tableCell.Value && nil != tableCell.Value.Number && tableCell.Value.Number.IsNotEmpty {
					tableCell.Value.Number.Format = col.NumberFormat
					tableCell.Value.Number.FormatNumber()
				}
			case av.KeyTypeTemplate: // 渲染模板列
				tableCell.Value = &av.Value{ID: tableCell.ID, KeyID: col.ID, BlockID: rowID, Type: av.KeyTypeTemplate, Template: &av.ValueTemplate{Content: col.Template}}
			case av.KeyTypeCreated: // 填充创建时间列值，后面再渲染
				tableCell.Value = &av.Value{ID: tableCell.ID, KeyID: col.ID, BlockID: rowID, Type: av.KeyTypeCreated}
			case av.KeyTypeUpdated: // 填充更新时间列值，后面再渲染
				tableCell.Value = &av.Value{ID: tableCell.ID, KeyID: col.ID, BlockID: rowID, Type: av.KeyTypeUpdated}
			case av.KeyTypeRelation: // 清空关联列值，后面再渲染 https://ld246.com/article/1703831044435
				if nil != tableCell.Value && nil != tableCell.Value.Relation {
					tableCell.Value.Relation.Contents = nil
				}
			}

			FillAttributeViewTableCellNilValue(tableCell, rowID, col.ID)

			tableRow.Cells = append(tableRow.Cells, tableCell)
		}
		ret.Rows = append(ret.Rows, &tableRow)
	}

	// 渲染自动生成的列值，比如关联列、汇总列、创建时间列和更新时间列
	for _, row := range ret.Rows {
		for _, cell := range row.Cells {
			switch cell.ValueType {
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

				destAv, _ := av.ParseAttributeView(relKey.Relation.AvID)
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

				// 将汇总列的值保存到 rows 中，后续渲染模板列的时候会用到，下同
				// Database table view template columns support reading relation, rollup, created and updated columns https://github.com/siyuan-note/siyuan/issues/10442
				keyValues := rows[row.ID]
				keyValues = append(keyValues, &av.KeyValues{Key: rollupKey, Values: []*av.Value{{ID: cell.Value.ID, KeyID: rollupKey.ID, BlockID: row.ID, Type: av.KeyTypeRollup, Rollup: cell.Value.Rollup}}})
				rows[row.ID] = keyValues
			case av.KeyTypeRelation: // 渲染关联列
				relKey, _ := attrView.GetKey(cell.Value.KeyID)
				if nil != relKey && nil != relKey.Relation {
					destAv, _ := av.ParseAttributeView(relKey.Relation.AvID)
					if nil != destAv {
						blocks := map[string]*av.Value{}
						for _, blockValue := range destAv.GetBlockKeyValues().Values {
							blocks[blockValue.BlockID] = blockValue
						}
						for _, blockID := range cell.Value.Relation.BlockIDs {
							if val := blocks[blockID]; nil != val {
								cell.Value.Relation.Contents = append(cell.Value.Relation.Contents, val)
							}
						}
					}
				}

				keyValues := rows[row.ID]
				keyValues = append(keyValues, &av.KeyValues{Key: relKey, Values: []*av.Value{{ID: cell.Value.ID, KeyID: relKey.ID, BlockID: row.ID, Type: av.KeyTypeRelation, Relation: cell.Value.Relation}}})
				rows[row.ID] = keyValues
			case av.KeyTypeCreated: // 渲染创建时间
				createdStr := row.ID[:len("20060102150405")]
				created, parseErr := time.ParseInLocation("20060102150405", createdStr, time.Local)
				if nil == parseErr {
					cell.Value.Created = av.NewFormattedValueCreated(created.UnixMilli(), 0, av.CreatedFormatNone)
					cell.Value.Created.IsNotEmpty = true
				} else {
					cell.Value.Created = av.NewFormattedValueCreated(time.Now().UnixMilli(), 0, av.CreatedFormatNone)
				}

				keyValues := rows[row.ID]
				createdKey, _ := attrView.GetKey(cell.Value.KeyID)
				keyValues = append(keyValues, &av.KeyValues{Key: createdKey, Values: []*av.Value{{ID: cell.Value.ID, KeyID: createdKey.ID, BlockID: row.ID, Type: av.KeyTypeCreated, Created: cell.Value.Created}}})
				rows[row.ID] = keyValues
			case av.KeyTypeUpdated: // 渲染更新时间
				ial := map[string]string{}
				block := row.GetBlockValue()
				if nil != block && !block.IsDetached {
					ial = GetBlockAttrsWithoutWaitWriting(row.ID)
				}
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

				keyValues := rows[row.ID]
				updatedKey, _ := attrView.GetKey(cell.Value.KeyID)
				keyValues = append(keyValues, &av.KeyValues{Key: updatedKey, Values: []*av.Value{{ID: cell.Value.ID, KeyID: updatedKey.ID, BlockID: row.ID, Type: av.KeyTypeUpdated, Updated: cell.Value.Updated}}})
				rows[row.ID] = keyValues
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
				keyValues := rows[row.ID]
				ial := map[string]string{}
				block := row.GetBlockValue()
				if nil != block && !block.IsDetached {
					ial = GetBlockAttrsWithoutWaitWriting(row.ID)
				}
				content, renderErr := RenderTemplateCol(ial, keyValues, cell.Value.Template.Content)
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

func RenderTemplateCol(ial map[string]string, rowValues []*av.KeyValues, tplContent string) (ret string, err error) {
	if "" == ial["id"] {
		block := getRowBlockValue(rowValues)
		if nil != block && nil != block.Block {
			ial["id"] = block.Block.ID
		}
	}
	if "" == ial["updated"] {
		block := getRowBlockValue(rowValues)
		if nil != block && nil != block.Block {
			ial["updated"] = time.UnixMilli(block.Block.Updated).Format("20060102150405")
		}
	}

	goTpl := template.New("").Delims(".action{", "}")
	tplFuncMap := util.BuiltInTemplateFuncs()
	SQLTemplateFuncs(&tplFuncMap)
	goTpl = goTpl.Funcs(tplFuncMap)
	tpl, err := goTpl.Parse(tplContent)
	if nil != err {
		logging.LogWarnf("parse template [%s] failed: %s", tplContent, err)
		return
	}

	buf := &bytes.Buffer{}
	dataModel := map[string]interface{}{} // 复制一份 IAL 以避免修改原始数据
	for k, v := range ial {
		dataModel[k] = v

		// Database template column supports `created` and `updated` built-in variables https://github.com/siyuan-note/siyuan/issues/9364
		createdStr := ial["id"]
		if "" != createdStr {
			createdStr = createdStr[:len("20060102150405")]
		}
		created, parseErr := time.ParseInLocation("20060102150405", createdStr, time.Local)
		if nil == parseErr {
			dataModel["created"] = created
		} else {
			logging.LogWarnf("parse created [%s] failed: %s", createdStr, parseErr)
			dataModel["created"] = time.Now()
		}
		updatedStr := ial["updated"]
		updated, parseErr := time.ParseInLocation("20060102150405", updatedStr, time.Local)
		if nil == parseErr {
			dataModel["updated"] = updated
		} else {
			dataModel["updated"] = time.Now()
		}
	}

	for _, rowValue := range rowValues {
		if 1 > len(rowValue.Values) {
			continue
		}

		v := rowValue.Values[0]
		if av.KeyTypeNumber == v.Type {
			if nil != v.Number && v.Number.IsNotEmpty {
				dataModel[rowValue.Key.Name] = v.Number.Content
			}
		} else if av.KeyTypeDate == v.Type {
			if nil != v.Date {
				if v.Date.IsNotEmpty {
					dataModel[rowValue.Key.Name] = time.UnixMilli(v.Date.Content)
				}
				if v.Date.IsNotEmpty2 {
					dataModel[rowValue.Key.Name+"_end"] = time.UnixMilli(v.Date.Content2)
				}
			}
		} else if av.KeyTypeRollup == v.Type {
			if 0 < len(v.Rollup.Contents) {
				var numbers []float64
				var contents []string
				for _, content := range v.Rollup.Contents {
					if av.KeyTypeNumber == content.Type {
						numbers = append(numbers, content.Number.Content)
					} else {
						contents = append(contents, content.String(true))
					}
				}

				if 0 < len(numbers) {
					dataModel[rowValue.Key.Name] = numbers
				} else {
					dataModel[rowValue.Key.Name] = contents
				}
			}
		} else if av.KeyTypeRelation == v.Type {
			if 0 < len(v.Relation.Contents) {
				var contents []string
				for _, content := range v.Relation.Contents {
					contents = append(contents, content.String(true))
				}
				dataModel[rowValue.Key.Name] = contents
			}
		} else {
			dataModel[rowValue.Key.Name] = v.String(true)
		}
	}

	if err = tpl.Execute(buf, dataModel); nil != err {
		logging.LogWarnf("execute template [%s] failed: %s", tplContent, err)
		return
	}
	ret = buf.String()
	return
}

func FillAttributeViewTableCellNilValue(tableCell *av.TableCell, rowID, colID string) {
	if nil == tableCell.Value {
		tableCell.Value = av.GetAttributeViewDefaultValue(tableCell.ID, colID, rowID, tableCell.ValueType)
		return
	}

	tableCell.Value.Type = tableCell.ValueType
	switch tableCell.ValueType {
	case av.KeyTypeText:
		if nil == tableCell.Value.Text {
			tableCell.Value.Text = &av.ValueText{}
		}
	case av.KeyTypeNumber:
		if nil == tableCell.Value.Number {
			tableCell.Value.Number = &av.ValueNumber{}
		}
	case av.KeyTypeDate:
		if nil == tableCell.Value.Date {
			tableCell.Value.Date = &av.ValueDate{}
		}
	case av.KeyTypeSelect:
		if 1 > len(tableCell.Value.MSelect) {
			tableCell.Value.MSelect = []*av.ValueSelect{}
		}
	case av.KeyTypeMSelect:
		if 1 > len(tableCell.Value.MSelect) {
			tableCell.Value.MSelect = []*av.ValueSelect{}
		}
	case av.KeyTypeURL:
		if nil == tableCell.Value.URL {
			tableCell.Value.URL = &av.ValueURL{}
		}
	case av.KeyTypeEmail:
		if nil == tableCell.Value.Email {
			tableCell.Value.Email = &av.ValueEmail{}
		}
	case av.KeyTypePhone:
		if nil == tableCell.Value.Phone {
			tableCell.Value.Phone = &av.ValuePhone{}
		}
	case av.KeyTypeMAsset:
		if 1 > len(tableCell.Value.MAsset) {
			tableCell.Value.MAsset = []*av.ValueAsset{}
		}
	case av.KeyTypeTemplate:
		if nil == tableCell.Value.Template {
			tableCell.Value.Template = &av.ValueTemplate{}
		}
	case av.KeyTypeCreated:
		if nil == tableCell.Value.Created {
			tableCell.Value.Created = &av.ValueCreated{}
		}
	case av.KeyTypeUpdated:
		if nil == tableCell.Value.Updated {
			tableCell.Value.Updated = &av.ValueUpdated{}
		}
	case av.KeyTypeCheckbox:
		if nil == tableCell.Value.Checkbox {
			tableCell.Value.Checkbox = &av.ValueCheckbox{}
		}
	case av.KeyTypeRelation:
		if nil == tableCell.Value.Relation {
			tableCell.Value.Relation = &av.ValueRelation{}
		}
	case av.KeyTypeRollup:
		if nil == tableCell.Value.Rollup {
			tableCell.Value.Rollup = &av.ValueRollup{}
		}
	}
}

func getAttributeViewContent(avID string,
	GetBlockAttrsWithoutWaitWriting func(id string) (ret map[string]string)) (content string) {
	if "" == avID {
		return
	}

	attrView, err := av.ParseAttributeView(avID)
	if nil != err {
		logging.LogErrorf("parse attribute view [%s] failed: %s", avID, err)
		return
	}

	buf := bytes.Buffer{}
	buf.WriteString(attrView.Name)
	buf.WriteByte(' ')
	for _, v := range attrView.Views {
		buf.WriteString(v.Name)
		buf.WriteByte(' ')
	}

	if 1 > len(attrView.Views) {
		content = strings.TrimSpace(buf.String())
		return
	}

	var view *av.View
	for _, v := range attrView.Views {
		if av.LayoutTypeTable == v.LayoutType {
			view = v
			break
		}
	}
	if nil == view {
		content = strings.TrimSpace(buf.String())
		return
	}

	table := RenderAttributeViewTable(attrView, view, "", GetBlockAttrsWithoutWaitWriting)
	for _, col := range table.Columns {
		buf.WriteString(col.Name)
		buf.WriteByte(' ')
	}

	for _, row := range table.Rows {
		for _, cell := range row.Cells {
			if nil == cell.Value {
				continue
			}
			buf.WriteString(cell.Value.String(true))
			buf.WriteByte(' ')
		}
	}

	content = strings.TrimSpace(buf.String())
	return
}

func getRowBlockValue(keyValues []*av.KeyValues) (ret *av.Value) {
	for _, kv := range keyValues {
		if av.KeyTypeBlock == kv.Key.Type && 0 < len(kv.Values) {
			ret = kv.Values[0]
			break
		}
	}
	return
}

func getAttrViewName(attrView *av.AttributeView) string {
	ret := strings.TrimSpace(attrView.Name)
	if "" == ret {
		ret = util.Langs[util.Lang][105]
	}
	return ret
}
