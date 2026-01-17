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
	"text/template/parse"
	"time"

	"github.com/88250/gulu"
	"github.com/jinzhu/copier"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func RenderGroupView(attrView *av.AttributeView, view, groupView *av.View, query string) (ret av.Viewable) {
	var err error
	switch groupView.LayoutType {
	case av.LayoutTypeTable:
		// 这里需要使用深拷贝，因为字段上可能会带有计算（FieldCalc），每个分组视图的计算结果都需要分别存储在不同的字段实例上
		err = copier.CopyWithOption(&groupView.Table.Columns, &view.Table.Columns, copier.Option{DeepCopy: true})
		groupView.Table.ShowIcon = view.Table.ShowIcon
		groupView.Table.WrapField = view.Table.WrapField
	case av.LayoutTypeGallery:
		err = copier.CopyWithOption(&groupView.Gallery.CardFields, &view.Gallery.CardFields, copier.Option{DeepCopy: true})
		groupView.Gallery.ShowIcon = view.Gallery.ShowIcon
		groupView.Gallery.WrapField = view.Gallery.WrapField

		groupView.Gallery.CoverFrom = view.Gallery.CoverFrom
		groupView.Gallery.CoverFromAssetKeyID = view.Gallery.CoverFromAssetKeyID
		groupView.Gallery.CardAspectRatio = view.Gallery.CardAspectRatio
		groupView.Gallery.CardSize = view.Gallery.CardSize
		groupView.Gallery.FitImage = view.Gallery.FitImage
		groupView.Gallery.DisplayFieldName = view.Gallery.DisplayFieldName
	case av.LayoutTypeKanban:
		err = copier.CopyWithOption(&groupView.Kanban.Fields, &view.Kanban.Fields, copier.Option{DeepCopy: true})
		groupView.Kanban.ShowIcon = view.Kanban.ShowIcon
		groupView.Kanban.WrapField = view.Kanban.WrapField

		groupView.Kanban.CoverFrom = view.Kanban.CoverFrom
		groupView.Kanban.CoverFromAssetKeyID = view.Kanban.CoverFromAssetKeyID
		groupView.Kanban.CardAspectRatio = view.Kanban.CardAspectRatio
		groupView.Kanban.CardSize = view.Kanban.CardSize
		groupView.Kanban.FitImage = view.Kanban.FitImage
		groupView.Kanban.DisplayFieldName = view.Kanban.DisplayFieldName
		groupView.Kanban.FillColBackgroundColor = view.Kanban.FillColBackgroundColor
	}
	if nil != err {
		logging.LogErrorf("copy view fields [%s] to group [%s] failed: %s", view.ID, groupView.ID, err)
		switch groupView.LayoutType {
		case av.LayoutTypeTable:
			groupView.Table.Columns = view.Table.Columns
		case av.LayoutTypeGallery:
			groupView.Gallery.CardFields = view.Gallery.CardFields
		case av.LayoutTypeKanban:
			groupView.Kanban.Fields = view.Kanban.Fields
		}
	}

	groupView.Filters = view.Filters
	groupView.Sorts = view.Sorts
	return RenderView(attrView, groupView, query)
}

func RenderView(attrView *av.AttributeView, view *av.View, query string) (ret av.Viewable) {
	depth := 1
	renderedAttrViews := map[string]*av.AttributeView{}
	renderedAttrViews[attrView.ID] = attrView
	ret = renderView(attrView, view, query, &depth, renderedAttrViews)

	attrView.RenderedViewables[ret.GetID()] = ret
	renderedAttrViews[attrView.ID] = attrView
	return
}

func renderView(attrView *av.AttributeView, view *av.View, query string, depth *int, cachedAttrViews map[string]*av.AttributeView) (ret av.Viewable) {
	if 7 < *depth {
		return
	}

	*depth++
	switch view.LayoutType {
	case av.LayoutTypeTable:
		ret = RenderAttributeViewTable(attrView, view, query, depth, cachedAttrViews)
	case av.LayoutTypeGallery:
		ret = RenderAttributeViewGallery(attrView, view, query, depth, cachedAttrViews)
	case av.LayoutTypeKanban:
		ret = RenderAttributeViewKanban(attrView, view, query, depth, cachedAttrViews)
	}
	return
}

func renderTemplateField(ial map[string]string, keyValues []*av.KeyValues, tplContent string) (ret string, err error) {
	if "" == ial["id"] {
		block := getBlockValue(keyValues)
		if nil != block {
			if nil != block.Block {
				ial["id"] = block.Block.ID
			}
			if "" == ial["id"] {
				ial["id"] = block.BlockID
			}
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
		} else if av.KeyTypeMSelect == v.Type {
			dataModel[keyValue.Key.Name+"_str"] = v.String(true)
			var contents []string
			for _, s := range v.MSelect {
				contents = append(contents, s.Content)
			}
			dataModel[keyValue.Key.Name] = contents
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
	if ret == "<no value>" {
		ret = ""
		return
	}

	if util.HasUnclosedHtmlTag(ret) {
		ret = util.EscapeHTML(ret)
	}
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
	if nil != view.GroupItemIDs {
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

func filterNotFoundAttrViewItems(keyValuesMap map[string][]*av.KeyValues) {
	var notFound []string
	var toCheckBlockIDs []string
	for blockID, keyValues := range keyValuesMap {
		blockValue := getBlockValue(keyValues)
		if nil == blockValue || nil == blockValue.Block {
			notFound = append(notFound, blockID)
			continue
		}

		if blockValue.IsDetached {
			continue
		}

		if "" == blockValue.Block.ID {
			notFound = append(notFound, blockID)
			continue
		}

		toCheckBlockIDs = append(toCheckBlockIDs, blockValue.Block.ID)
	}
	checkRet := treenode.ExistBlockTrees(toCheckBlockIDs)
	for blockID, exist := range checkRet {
		if !exist {
			notFound = append(notFound, blockID)
		}
	}
	for _, blockID := range notFound {
		delete(keyValuesMap, blockID)
	}
}

func fillAttributeViewBaseValue(baseValue *av.BaseValue, fieldID, itemID string, fieldNumberFormat av.NumberFormat, fieldTemplate string, fieldDateIsTime bool) {
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
	}

	if nil == baseValue.Value {
		baseValue.Value = av.GetAttributeViewDefaultValue(baseValue.ID, fieldID, itemID, baseValue.ValueType, fieldDateIsTime)
	} else {
		FillAttributeViewNilValue(baseValue.Value, baseValue.ValueType)
	}
}

func fillAttributeViewAutoGeneratedValues(attrView *av.AttributeView, collection av.Collection, ials map[string]map[string]string, depth *int, cachedAttrViews map[string]*av.AttributeView) {
	// 渲染主键、创建时间、更新时间

	for _, item := range collection.GetItems() {
		for _, value := range item.GetValues() {
			itemID := item.GetID()

			switch value.Type {
			case av.KeyTypeBlock: // 对于主键可能需要填充静态锚文本 Database-bound block primary key supports setting static anchor text https://github.com/siyuan-note/siyuan/issues/10049
				if nil != value.Block {
					for k, v := range ials[value.Block.ID] {
						if k == av.NodeAttrViewStaticText+"-"+attrView.ID {
							value.Block.Content = v
							break
						}
					}
				}
			case av.KeyTypeCreated: // 渲染创建时间
				key, _ := attrView.GetKey(value.KeyID)
				isNotTime := false
				if nil != key && nil != key.Created {
					isNotTime = !key.Created.IncludeTime
				}

				ial := map[string]string{}
				block := item.GetBlockValue()
				if nil != block {
					ial = ials[block.Block.ID]
				}
				if nil == ial {
					ial = map[string]string{}
				}
				id := itemID
				if "" != ial["id"] {
					id = ial["id"]
				}
				createdStr := id[:len("20060102150405")]
				created, parseErr := time.ParseInLocation("20060102150405", createdStr, time.Local)
				if nil == parseErr {
					value.Created = av.NewFormattedValueCreated(created.UnixMilli(), 0, av.CreatedFormatNone, isNotTime)
					value.Created.IsNotEmpty = true
				} else {
					value.Created = av.NewFormattedValueCreated(time.Now().UnixMilli(), 0, av.CreatedFormatNone, isNotTime)
				}
			case av.KeyTypeUpdated: // 渲染更新时间
				key, _ := attrView.GetKey(value.KeyID)
				isNotTime := false
				if nil != key && nil != key.Updated {
					isNotTime = !key.Updated.IncludeTime
				}

				ial := map[string]string{}
				block := item.GetBlockValue()
				if nil != block {
					ial = ials[block.Block.ID]
				}
				if nil == ial {
					ial = map[string]string{}
				}
				updatedStr := ial["updated"]
				if "" == updatedStr && nil != block {
					value.Updated = av.NewFormattedValueUpdated(block.Block.Updated, 0, av.UpdatedFormatNone, isNotTime)
					value.Updated.IsNotEmpty = true
				} else {
					updated, parseErr := time.ParseInLocation("20060102150405", updatedStr, time.Local)
					if nil == parseErr {
						value.Updated = av.NewFormattedValueUpdated(updated.UnixMilli(), 0, av.UpdatedFormatNone, isNotTime)
						value.Updated.IsNotEmpty = true
					} else {
						value.Updated = av.NewFormattedValueUpdated(time.Now().UnixMilli(), 0, av.UpdatedFormatNone, isNotTime)
					}
				}
			}
		}
	}

	// 渲染关联
	for _, item := range collection.GetItems() {
		for _, value := range item.GetValues() {
			if av.KeyTypeRelation != value.Type {
				continue
			}

			value.Relation.Contents = nil
			relKey, _ := attrView.GetKey(value.KeyID)
			if nil != relKey && nil != relKey.Relation {
				destAv := cachedAttrViews[relKey.Relation.AvID]
				if nil == destAv {
					destAv, _ = av.ParseAttributeView(relKey.Relation.AvID)
					if nil != destAv {
						cachedAttrViews[relKey.Relation.AvID] = destAv
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
		}
	}

	// 渲染汇总
	rollupFurtherCollections := map[string]av.Collection{}
	for _, field := range collection.GetFields() {
		if av.KeyTypeRollup != field.GetType() {
			continue
		}

		rollupKey, _ := attrView.GetKey(field.GetID())
		if nil == rollupKey || nil == rollupKey.Rollup {
			continue
		}

		relKey, _ := attrView.GetKey(rollupKey.Rollup.RelationKeyID)
		if nil == relKey || nil == relKey.Relation {
			continue
		}

		destAv := cachedAttrViews[relKey.Relation.AvID]
		if nil == destAv {
			destAv, _ = av.ParseAttributeView(relKey.Relation.AvID)
			if nil != destAv {
				cachedAttrViews[relKey.Relation.AvID] = destAv
			}
		}
		if nil == destAv {
			continue
		}

		destKey, _ := destAv.GetKey(rollupKey.Rollup.KeyID)
		if nil == destKey {
			continue
		}

		isSameAv := destAv.ID == attrView.ID
		var furtherCollection av.Collection
		if av.KeyTypeTemplate == destKey.Type || (!isSameAv && (av.KeyTypeUpdated == destKey.Type || av.KeyTypeCreated == destKey.Type || av.KeyTypeRelation == destKey.Type)) {
			viewable := renderView(destAv, destAv.Views[0], "", depth, cachedAttrViews)
			if nil != viewable {
				furtherCollection = viewable.(av.Collection)
			} else {
				fillAttributeViewTemplateValues(destAv, destAv.Views[0], collection, ials)
				furtherCollection = collection
			}
		}
		rollupFurtherCollections[rollupKey.ID] = furtherCollection
	}

	for _, item := range collection.GetItems() {
		for _, value := range item.GetValues() {
			if av.KeyTypeRollup != value.Type {
				continue
			}

			rollupKey, _ := attrView.GetKey(value.KeyID)
			if nil == rollupKey || nil == rollupKey.Rollup {
				break
			}

			relKey, _ := attrView.GetKey(rollupKey.Rollup.RelationKeyID)
			if nil == relKey || nil == relKey.Relation {
				break
			}

			relVal := attrView.GetValue(relKey.ID, item.GetID())
			if nil == relVal || nil == relVal.Relation {
				break
			}

			destAv := cachedAttrViews[relKey.Relation.AvID]
			if nil == destAv {
				destAv, _ = av.ParseAttributeView(relKey.Relation.AvID)
				if nil != destAv {
					cachedAttrViews[relKey.Relation.AvID] = destAv
				}
			}
			if nil == destAv {
				break
			}

			destKey, _ := destAv.GetKey(rollupKey.Rollup.KeyID)
			if nil == destKey {
				break
			}

			furtherCollection := rollupFurtherCollections[rollupKey.ID]
			value.Rollup.BuildContents(destAv.KeyValues, destKey, relVal, rollupKey.Rollup.Calc, furtherCollection)
		}
	}
}

func GetFurtherCollections(attrView *av.AttributeView, cachedAttrViews map[string]*av.AttributeView) (ret map[string]av.Collection) {
	ret = map[string]av.Collection{}
	for _, kv := range attrView.KeyValues {
		if av.KeyTypeRollup != kv.Key.Type {
			continue
		}

		if nil == kv.Key.Rollup {
			continue
		}

		relKey, _ := attrView.GetKey(kv.Key.Rollup.RelationKeyID)
		if nil == relKey {
			continue
		}

		destAv := cachedAttrViews[relKey.Relation.AvID]
		if nil == destAv {
			destAv, _ = av.ParseAttributeView(relKey.Relation.AvID)
			if nil == destAv {
				continue
			}
			cachedAttrViews[relKey.Relation.AvID] = destAv
		}

		destKey, _ := destAv.GetKey(kv.Key.Rollup.KeyID)
		if nil == destKey {
			continue
		}
		isSameAv := destAv.ID == attrView.ID

		var furtherCollection av.Collection
		if av.KeyTypeTemplate == destKey.Type || (!isSameAv && (av.KeyTypeUpdated == destKey.Type || av.KeyTypeCreated == destKey.Type || av.KeyTypeRelation == destKey.Type)) {
			viewable := RenderView(destAv, destAv.Views[0], "")
			if nil != viewable {
				furtherCollection = viewable.(av.Collection)
			}
		}
		ret[kv.Key.ID] = furtherCollection
	}
	return
}

func fillAttributeViewTemplateValues(attrView *av.AttributeView, view *av.View, collection av.Collection, ials map[string]map[string]string) (err error) {
	items := generateAttrViewItems(attrView, view)
	existTemplateField := false
	for _, kVals := range attrView.KeyValues {
		if av.KeyTypeTemplate == kVals.Key.Type {
			existTemplateField = true
			break
		}
	}
	if !existTemplateField {
		return
	}

	templateKeys, _ := GetTemplateKeysByResolutionOrder(attrView)
	for _, templateKey := range templateKeys {
		for _, item := range collection.GetItems() {
			value := item.GetValue(templateKey.ID)
			if nil == value || nil == value.Template {
				continue
			}

			keyValues := items[item.GetID()]
			var ial map[string]string
			blockVal := item.GetBlockValue()
			if nil != blockVal {
				ial = ials[blockVal.Block.ID]
			}
			if nil == ial {
				ial = map[string]string{}
			}

			content, renderErr := renderTemplateField(ial, keyValues, value.Template.Content)
			if nil != renderErr {
				key, _ := attrView.GetKey(value.KeyID)
				keyName := ""
				if nil != key {
					keyName = key.Name
				}
				err = fmt.Errorf("database [%s] template field [%s] rendering failed: %s", getAttrViewName(attrView), keyName, renderErr)
			}

			value.Template.Content = content
			items[item.GetID()] = append(keyValues, &av.KeyValues{Key: templateKey, Values: []*av.Value{value}})
		}
	}
	return
}

func fillAttributeViewKeyValues(attrView *av.AttributeView, collection av.Collection) {
	fieldValues := map[string][]*av.Value{}
	for _, item := range collection.GetItems() {
		for _, val := range item.GetValues() {
			keyID := val.KeyID
			fieldValues[keyID] = append(fieldValues[keyID], val)
		}
	}
	for keyID, values := range fieldValues {
		keyValues, _ := attrView.GetKeyValues(keyID)
		for _, val := range values {
			exist := false
			for _, kv := range keyValues.Values {
				if kv.ID == val.ID {
					exist = true
					break
				}
			}
			if !exist {
				val.IsRenderAutoFill = true
				keyValues.Values = append(keyValues.Values, val)
			}
		}
	}
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

	if nil != view.Kanban {
		for i, kanbanField := range view.Kanban.Fields {
			if kanbanField.ID == missingKeyID {
				view.Kanban.Fields = append(view.Kanban.Fields[:i], view.Kanban.Fields[i+1:]...)
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
					if !util.SearchCaseSensitive {
						if !strings.Contains(strings.ToLower(cell.String(true)), strings.ToLower(keyword)) {
							allKeywordsHit = false
							break
						}
					} else {
						if !strings.Contains(cell.String(true), keyword) {
							allKeywordsHit = false
							break
						}
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
	itemIDs := view.ItemIDs
	// 如果是分组视图，则需要根据分组项的顺序进行排序
	if 0 < len(view.GroupItemIDs) {
		itemIDs = view.GroupItemIDs
	}

	sortItemIDs := map[string]int{}
	for i, itemID := range itemIDs {
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

func GetTemplateKeysByResolutionOrder(attrView *av.AttributeView) (ret []*av.Key, resolved bool) {
	ret = []*av.Key{}

	resolvedTemplateKeys := map[string]bool{}
	for i := 0; i < 7; i++ {
		templateKeyCount := 0
		for _, keyValues := range attrView.KeyValues {
			if av.KeyTypeTemplate != keyValues.Key.Type {
				continue
			}

			templateKeyCount++
			vars, err := getTemplateVars(keyValues.Key.Template)
			if nil != err {
				resolvedTemplateKeys[keyValues.Key.ID] = true
				ret = append(ret, keyValues.Key)
				continue
			}

			currentTemplateKeyResolved := true
			for _, kValues := range attrView.KeyValues {
				if gulu.Str.Contains(kValues.Key.Name, vars) {
					if av.KeyTypeTemplate == kValues.Key.Type {
						if _, ok := resolvedTemplateKeys[kValues.Key.ID]; !ok {
							currentTemplateKeyResolved = false
							break
						}
					}
				}
			}
			if currentTemplateKeyResolved {
				resolvedTemplateKeys[keyValues.Key.ID] = true
				ret = append(ret, keyValues.Key)
			}
		}

		resolved = len(resolvedTemplateKeys) == templateKeyCount
		if resolved {
			break
		}
	}
	return
}

func GetTemplateKeyRelevantKeys(attrView *av.AttributeView, templateKey *av.Key) (ret []*av.Key) {
	ret = []*av.Key{}
	if nil == templateKey || "" == templateKey.Template {
		return
	}

	vars, err := getTemplateVars(templateKey.Template)
	if nil != err {
		return
	}

	for _, kValues := range attrView.KeyValues {
		if gulu.Str.Contains(kValues.Key.Name, vars) {
			ret = append(ret, kValues.Key)
		}
	}

	if 1 > len(ret) {
		// 没有相关字段情况下直接尝试解析模板，如果能解析成功则返回模板字段本身 https://github.com/siyuan-note/siyuan/issues/15560#issuecomment-3182691193
		goTpl := template.New("").Delims(".action{", "}")
		tplFuncMap := filesys.BuiltInTemplateFuncs()
		SQLTemplateFuncs(&tplFuncMap)
		goTpl = goTpl.Funcs(tplFuncMap)
		_, parseErr := goTpl.Funcs(tplFuncMap).Parse(templateKey.Template)
		if nil != parseErr {
			return
		}
		ret = append(ret, templateKey)
	}
	return
}

func getTemplateVars(tplContent string) ([]string, error) {
	goTpl := template.New("").Delims(".action{", "}")
	tplFuncMap := filesys.BuiltInTemplateFuncs()
	SQLTemplateFuncs(&tplFuncMap)
	goTpl = goTpl.Funcs(tplFuncMap)
	tpl, parseErr := goTpl.Funcs(tplFuncMap).Parse(tplContent)
	if parseErr != nil {
		return nil, parseErr
	}
	vars := make(map[string]struct{})
	collectVars(tpl.Tree.Root, vars)
	var result []string
	for v := range vars {
		result = append(result, v)
	}
	return result, nil
}

func collectVars(node parse.Node, vars map[string]struct{}) {
	switch n := node.(type) {
	case *parse.ListNode:
		for _, child := range n.Nodes {
			collectVars(child, vars)
		}
	case *parse.ActionNode:
		collectVars(n.Pipe, vars)
	case *parse.PipeNode:
		for _, cmd := range n.Cmds {
			collectVars(cmd, vars)
		}
	case *parse.CommandNode:
		for _, arg := range n.Args {
			collectVars(arg, vars)
		}

		if 3 <= len(n.Args) && n.Args[0].Type() == parse.NodeIdentifier && n.Args[1].Type() == parse.NodeDot && n.Args[2].Type() == parse.NodeString {
			vars[n.Args[2].(*parse.StringNode).Text] = struct{}{}
		}

	case *parse.FieldNode:
		if len(n.Ident) > 0 {
			vars[n.Ident[0]] = struct{}{}
		}
	case *parse.VariableNode:
		if len(n.Ident) > 0 {
			vars[n.Ident[0]] = struct{}{}
		}
	}
}
