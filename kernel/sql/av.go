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
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func RenderView(view *av.View, attrView *av.AttributeView, query string) (ret av.Viewable) {
	switch view.LayoutType {
	case av.LayoutTypeTable:
		ret = RenderAttributeViewTable(attrView, view, query)
	case av.LayoutTypeGallery:
		ret = RenderAttributeViewGallery(attrView, view, query)
	}
	return
}

func RenderTemplateField(ial map[string]string, keyValues []*av.KeyValues, tplContent string) (ret string, err error) {
	if "" == ial["id"] {
		block := getBlockValue(keyValues)
		if nil != block && nil != block.Block {
			ial["id"] = block.Block.ID
		}
	}
	if "" == ial["updated"] {
		block := getBlockValue(keyValues)
		if nil != block && nil != block.Block {
			ial["updated"] = time.UnixMilli(block.Block.Updated).Format("20060102150405")
		}
	}

	goTpl := template.New("").Delims(".action{", "}")
	tplFuncMap := filesys.BuiltInTemplateFuncs()
	SQLTemplateFuncs(&tplFuncMap)
	goTpl = goTpl.Funcs(tplFuncMap)
	tpl, err := goTpl.Parse(tplContent)
	if err != nil {
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
			errMsg := parseErr.Error()
			//logging.LogWarnf("parse created [%s] failed: %s", createdStr, errMsg)
			if strings.Contains(errMsg, "minute out of range") {
				// parsing time "20240709158553": minute out of range
				// 将分秒部分置为 0000
				createdStr = createdStr[:len("2006010215")] + "0000"
			} else if strings.Contains(errMsg, "second out of range") {
				// parsing time "20240709154592": second out of range
				// 将秒部分置为 00
				createdStr = createdStr[:len("200601021504")] + "00"
			}
			created, parseErr = time.ParseInLocation("20060102150405", createdStr, time.Local)
		}
		if nil != parseErr {
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

	dataModel["id_mod"] = map[string]any{}
	dataModel["id_mod_raw"] = map[string]any{}
	for _, keyValue := range keyValues {
		if 1 > len(keyValue.Values) {
			continue
		}

		v := keyValue.Values[0]
		if av.KeyTypeNumber == v.Type {
			if nil != v.Number && v.Number.IsNotEmpty {
				dataModel[keyValue.Key.Name] = v.Number.Content
			}
		} else if av.KeyTypeDate == v.Type {
			if nil != v.Date {
				if v.Date.IsNotEmpty {
					dataModel[keyValue.Key.Name] = time.UnixMilli(v.Date.Content)
				}
				if v.Date.IsNotEmpty2 {
					dataModel[keyValue.Key.Name+"_end"] = time.UnixMilli(v.Date.Content2)
				}
			}
		} else if av.KeyTypeRollup == v.Type {
			if 0 < len(v.Rollup.Contents) {
				var numbers []float64
				var contents []string
				for _, content := range v.Rollup.Contents {
					if av.KeyTypeNumber == content.Type {
						numbers = append(numbers, content.Number.Content)
					} else if av.KeyTypeMSelect == content.Type {
						for _, s := range content.MSelect {
							contents = append(contents, s.Content)
						}
					} else {
						contents = append(contents, content.String(true))
					}
				}

				if 0 < len(numbers) {
					dataModel[keyValue.Key.Name] = numbers
				} else {
					dataModel[keyValue.Key.Name] = contents
				}
			}
		} else if av.KeyTypeRelation == v.Type {
			if 0 < len(v.Relation.Contents) {
				var contents []string
				for _, content := range v.Relation.Contents {
					contents = append(contents, content.String(true))
				}
				dataModel[keyValue.Key.Name] = contents
			}
		} else if av.KeyTypeBlock == v.Type {
			dataModel[keyValue.Key.Name+"_created"] = time.Now()
			if nil != v.Block {
				dataModel["entryCreated"] = time.UnixMilli(v.Block.Created)
			}
			dataModel["entryUpdated"] = time.Now()
			if nil != v.Block {
				dataModel["entryUpdated"] = time.UnixMilli(v.Block.Updated)
			}
			dataModel[keyValue.Key.Name] = v.String(true)
		} else {
			dataModel[keyValue.Key.Name] = v.String(true)
		}

		// Database template fields support access to the raw value https://github.com/siyuan-note/siyuan/issues/14903
		dataModel[keyValue.Key.Name+"_raw"] = v

		// Database template fields support access by ID https://github.com/siyuan-note/siyuan/issues/11237
		dataModel["id_mod"].(map[string]any)[keyValue.Key.ID] = dataModel[keyValue.Key.Name]
		dataModel["id_mod_raw"].(map[string]any)[keyValue.Key.ID] = v
	}

	if err = tpl.Execute(buf, dataModel); err != nil {
		logging.LogWarnf("execute template [%s] failed: %s", tplContent, err)
		return
	}
	ret = buf.String()
	return
}

func generateAttrViewItems(attrView *av.AttributeView, view *av.View) (ret map[string][]*av.KeyValues) {
	ret = map[string][]*av.KeyValues{}
	for _, keyValues := range attrView.KeyValues {
		for _, val := range keyValues.Values {
			values := ret[val.BlockID]
			if nil == values {
				values = []*av.KeyValues{{Key: keyValues.Key, Values: []*av.Value{val}}}
			} else {
				values = append(values, &av.KeyValues{Key: keyValues.Key, Values: []*av.Value{val}})
			}
			ret[val.BlockID] = values
		}
	}

	// 如果是分组视图，则需要过滤掉不在分组中的项目
	if 0 < len(view.GroupItemIDs) {
		tmp := map[string][]*av.KeyValues{}
		for _, groupItemID := range view.GroupItemIDs {
			if _, ok := ret[groupItemID]; ok {
				tmp[groupItemID] = ret[groupItemID]
			}
		}
		ret = tmp
	}
	return
}

func filterNotFoundAttrViewItems(keyValuesMap *map[string][]*av.KeyValues) {
	var notFound []string
	var toCheckBlockIDs []string
	for blockID, keyValues := range *keyValuesMap {
		blockValue := getBlockValue(keyValues)
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

		toCheckBlockIDs = append(toCheckBlockIDs, blockID)
	}
	checkRet := treenode.ExistBlockTrees(toCheckBlockIDs)
	for blockID, exist := range checkRet {
		if !exist {
			notFound = append(notFound, blockID)
		}
	}
	for _, blockID := range notFound {
		delete(*keyValuesMap, blockID)
	}
}

func fillAttributeViewBaseValue(baseValue *av.BaseValue, fieldID, itemID string, fieldNumberFormat av.NumberFormat, fieldTemplate string) {
	switch baseValue.ValueType {
	case av.KeyTypeNumber: // 格式化数字
		if nil != baseValue.Value && nil != baseValue.Value.Number && baseValue.Value.Number.IsNotEmpty {
			baseValue.Value.Number.Format = fieldNumberFormat
			baseValue.Value.Number.FormatNumber()
		}
	case av.KeyTypeTemplate: // 渲染模板字段
		baseValue.Value = &av.Value{ID: baseValue.ID, KeyID: fieldID, BlockID: itemID, Type: av.KeyTypeTemplate, Template: &av.ValueTemplate{Content: fieldTemplate}}
	case av.KeyTypeCreated: // 填充创建时间字段值，后面再渲染
		baseValue.Value = &av.Value{ID: baseValue.ID, KeyID: fieldID, BlockID: itemID, Type: av.KeyTypeCreated}
	case av.KeyTypeUpdated: // 填充更新时间字段值，后面再渲染
		baseValue.Value = &av.Value{ID: baseValue.ID, KeyID: fieldID, BlockID: itemID, Type: av.KeyTypeUpdated}
	case av.KeyTypeRelation: // 清空关联字段值，后面再渲染 https://ld246.com/article/1703831044435
		if nil != baseValue.Value && nil != baseValue.Value.Relation {
			baseValue.Value.Relation.Contents = nil
		}
	}

	if nil == baseValue.Value {
		baseValue.Value = av.GetAttributeViewDefaultValue(baseValue.ID, fieldID, itemID, baseValue.ValueType)
	} else {
		FillAttributeViewNilValue(baseValue.Value, baseValue.ValueType)
	}
}

func fillAttributeViewAutoGeneratedValues(attrView *av.AttributeView, ials map[string]map[string]string, value *av.Value, item av.Item, items map[string][]*av.KeyValues, avCache *map[string]*av.AttributeView) {
	itemID := item.GetID()

	switch value.Type {
	case av.KeyTypeBlock: // 对于主键可能需要填充静态锚文本 Database-bound block primary key supports setting static anchor text https://github.com/siyuan-note/siyuan/issues/10049
		if nil != value.Block {
			for k, v := range ials[itemID] {
				if k == av.NodeAttrViewStaticText+"-"+attrView.ID {
					value.Block.Content = v
					break
				}
			}
		}
	case av.KeyTypeRollup: // 渲染汇总列
		rollupKey, _ := attrView.GetKey(value.KeyID)
		if nil == rollupKey || nil == rollupKey.Rollup {
			break
		}

		relKey, _ := attrView.GetKey(rollupKey.Rollup.RelationKeyID)
		if nil == relKey || nil == relKey.Relation {
			break
		}

		relVal := attrView.GetValue(relKey.ID, itemID)
		if nil == relVal || nil == relVal.Relation {
			break
		}

		destAv := (*avCache)[relKey.Relation.AvID]
		if nil == destAv {
			destAv, _ = av.ParseAttributeView(relKey.Relation.AvID)
			if nil != destAv {
				(*avCache)[relKey.Relation.AvID] = destAv
			}
		}
		if nil == destAv {
			break
		}

		destKey, _ := destAv.GetKey(rollupKey.Rollup.KeyID)
		if nil == destKey {
			return
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

			value.Rollup.Contents = append(value.Rollup.Contents, destVal.Clone())
		}

		value.Rollup.RenderContents(rollupKey.Rollup.Calc, destKey)

		// 将汇总列的值保存到 rowsValues 中，后续渲染模板列的时候会用到，下同
		// Database table view template columns support reading relation, rollup, created and updated columns https://github.com/siyuan-note/siyuan/issues/10442
		keyValues := items[itemID]
		keyValues = append(keyValues, &av.KeyValues{Key: rollupKey, Values: []*av.Value{{ID: value.ID, KeyID: rollupKey.ID, BlockID: itemID, Type: av.KeyTypeRollup, Rollup: value.Rollup}}})
		items[itemID] = keyValues
	case av.KeyTypeRelation: // 渲染关联列
		relKey, _ := attrView.GetKey(value.KeyID)
		if nil != relKey && nil != relKey.Relation {
			destAv := (*avCache)[relKey.Relation.AvID]
			if nil == destAv {
				destAv, _ = av.ParseAttributeView(relKey.Relation.AvID)
				if nil != destAv {
					(*avCache)[relKey.Relation.AvID] = destAv
				}
			}
			if nil != destAv {
				blocks := map[string]*av.Value{}
				blockValues := destAv.GetBlockKeyValues()
				if nil != blockValues {
					for _, blockValue := range blockValues.Values {
						blocks[blockValue.BlockID] = blockValue
					}
					for _, blockID := range value.Relation.BlockIDs {
						if val := blocks[blockID]; nil != val {
							value.Relation.Contents = append(value.Relation.Contents, val)
						}
					}
				}
			}
		}

		keyValues := items[itemID]
		keyValues = append(keyValues, &av.KeyValues{Key: relKey, Values: []*av.Value{{ID: value.ID, KeyID: relKey.ID, BlockID: itemID, Type: av.KeyTypeRelation, Relation: value.Relation}}})
		items[itemID] = keyValues
	case av.KeyTypeCreated: // 渲染创建时间
		createdStr := itemID[:len("20060102150405")]
		created, parseErr := time.ParseInLocation("20060102150405", createdStr, time.Local)
		if nil == parseErr {
			value.Created = av.NewFormattedValueCreated(created.UnixMilli(), 0, av.CreatedFormatNone)
			value.Created.IsNotEmpty = true
		} else {
			value.Created = av.NewFormattedValueCreated(time.Now().UnixMilli(), 0, av.CreatedFormatNone)
		}

		keyValues := items[itemID]
		createdKey, _ := attrView.GetKey(value.KeyID)
		keyValues = append(keyValues, &av.KeyValues{Key: createdKey, Values: []*av.Value{{ID: value.ID, KeyID: createdKey.ID, BlockID: itemID, Type: av.KeyTypeCreated, Created: value.Created}}})
		items[itemID] = keyValues
	case av.KeyTypeUpdated: // 渲染更新时间
		ial := ials[itemID]
		if nil == ial {
			ial = map[string]string{}
		}
		block := item.GetBlockValue()
		updatedStr := ial["updated"]
		if "" == updatedStr && nil != block {
			value.Updated = av.NewFormattedValueUpdated(block.Block.Updated, 0, av.UpdatedFormatNone)
			value.Updated.IsNotEmpty = true
		} else {
			updated, parseErr := time.ParseInLocation("20060102150405", updatedStr, time.Local)
			if nil == parseErr {
				value.Updated = av.NewFormattedValueUpdated(updated.UnixMilli(), 0, av.UpdatedFormatNone)
				value.Updated.IsNotEmpty = true
			} else {
				value.Updated = av.NewFormattedValueUpdated(time.Now().UnixMilli(), 0, av.UpdatedFormatNone)
			}
		}

		keyValues := items[itemID]
		updatedKey, _ := attrView.GetKey(value.KeyID)
		keyValues = append(keyValues, &av.KeyValues{Key: updatedKey, Values: []*av.Value{{ID: value.ID, KeyID: updatedKey.ID, BlockID: itemID, Type: av.KeyTypeUpdated, Updated: value.Updated}}})
		items[itemID] = keyValues
	}
}

func fillAttributeViewTemplateValue(value *av.Value, item av.Item, attrView *av.AttributeView, ials map[string]map[string]string, items map[string][]*av.KeyValues) (err error) {
	itemID := item.GetID()

	switch value.Type {
	case av.KeyTypeTemplate: // 渲染模板字段
		keyValues := items[itemID]
		ial := ials[itemID]
		if nil == ial {
			ial = map[string]string{}
		}
		content, renderErr := RenderTemplateField(ial, keyValues, value.Template.Content)
		value.Template.Content = content
		if nil != renderErr {
			key, _ := attrView.GetKey(value.KeyID)
			keyName := ""
			if nil != key {
				keyName = key.Name
			}
			err = fmt.Errorf("database [%s] template field [%s] rendering failed: %s", getAttrViewName(attrView), keyName, renderErr)
		}
	}
	return
}

func FillAttributeViewNilValue(value *av.Value, typ av.KeyType) {
	value.Type = typ
	switch typ {
	case av.KeyTypeText:
		if nil == value.Text {
			value.Text = &av.ValueText{}
		}
	case av.KeyTypeNumber:
		if nil == value.Number {
			value.Number = &av.ValueNumber{}
		}
	case av.KeyTypeDate:
		if nil == value.Date {
			value.Date = &av.ValueDate{}
		}
	case av.KeyTypeSelect:
		if 1 > len(value.MSelect) {
			value.MSelect = []*av.ValueSelect{}
		}
	case av.KeyTypeMSelect:
		if 1 > len(value.MSelect) {
			value.MSelect = []*av.ValueSelect{}
		}
	case av.KeyTypeURL:
		if nil == value.URL {
			value.URL = &av.ValueURL{}
		}
	case av.KeyTypeEmail:
		if nil == value.Email {
			value.Email = &av.ValueEmail{}
		}
	case av.KeyTypePhone:
		if nil == value.Phone {
			value.Phone = &av.ValuePhone{}
		}
	case av.KeyTypeMAsset:
		if 1 > len(value.MAsset) {
			value.MAsset = []*av.ValueAsset{}
		}
	case av.KeyTypeTemplate:
		if nil == value.Template {
			value.Template = &av.ValueTemplate{}
		}
	case av.KeyTypeCreated:
		if nil == value.Created {
			value.Created = &av.ValueCreated{}
		}
	case av.KeyTypeUpdated:
		if nil == value.Updated {
			value.Updated = &av.ValueUpdated{}
		}
	case av.KeyTypeCheckbox:
		if nil == value.Checkbox {
			value.Checkbox = &av.ValueCheckbox{}
		}
	case av.KeyTypeRelation:
		if nil == value.Relation {
			value.Relation = &av.ValueRelation{}
		}
	case av.KeyTypeRollup:
		if nil == value.Rollup {
			value.Rollup = &av.ValueRollup{}
		}
	}
}

func getAttributeViewContent(avID string) (content string) {
	if "" == avID {
		return
	}

	attrView, err := av.ParseAttributeView(avID)
	if err != nil {
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

func getBlockValue(keyValues []*av.KeyValues) (ret *av.Value) {
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

func removeMissingField(attrView *av.AttributeView, view *av.View, missingKeyID string) {
	logging.LogWarnf("key [%s] is missing", missingKeyID)

	changed := false
	if nil != view.Table {
		for i, column := range view.Table.Columns {
			if column.ID == missingKeyID {
				view.Table.Columns = append(view.Table.Columns[:i], view.Table.Columns[i+1:]...)
				changed = true
				break
			}
		}
	}

	if nil != view.Gallery {
		for i, cardField := range view.Gallery.CardFields {
			if cardField.ID == missingKeyID {
				view.Gallery.CardFields = append(view.Gallery.CardFields[:i], view.Gallery.CardFields[i+1:]...)
				changed = true
				break
			}
		}
	}

	if changed {
		av.SaveAttributeView(attrView)
	}
}

// filterByQuery 根据搜索条件过滤
func filterByQuery(query string, collection av.Collection) {
	query = strings.TrimSpace(query)
	if "" != query {
		query = strings.Join(strings.Fields(query), " ") // 将连续空格转换为一个空格
		keywords := strings.Split(query, " ")            // 按空格分割关键字

		// 使用 AND 逻辑 https://github.com/siyuan-note/siyuan/issues/11535
		var hitItems []av.Item
		for _, item := range collection.GetItems() {
			hit := false
			for _, cell := range item.GetValues() {
				allKeywordsHit := true
				for _, keyword := range keywords {
					if !strings.Contains(strings.ToLower(cell.String(true)), strings.ToLower(keyword)) {
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
				hitItems = append(hitItems, item)
			}
		}
		collection.SetItems(hitItems)
		if 1 > len(collection.GetItems()) {
			collection.SetItems([]av.Item{})
		}
	}
}

// manualSort 处理用户手动排序。
func manualSort(view *av.View, collection av.Collection) {
	sortItemIDs := map[string]int{}
	for i, itemID := range view.ItemIDs {
		sortItemIDs[itemID] = i
	}

	items := collection.GetItems()
	sort.Slice(items, func(i, j int) bool {
		iv := sortItemIDs[items[i].GetID()]
		jv := sortItemIDs[items[j].GetID()]
		if iv == jv {
			return items[i].GetID() < items[j].GetID()
		}
		return iv < jv
	})
	collection.SetItems(items)
}
