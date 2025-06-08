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
	"strings"
	"text/template"
	"time"

	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func RenderTemplateField(ial map[string]string, rowValues []*av.KeyValues, tplContent string) (ret string, err error) {
	if "" == ial["id"] {
		block := getBlockValue(rowValues)
		if nil != block && nil != block.Block {
			ial["id"] = block.Block.ID
		}
	}
	if "" == ial["updated"] {
		block := getBlockValue(rowValues)
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
					} else if av.KeyTypeMSelect == content.Type {
						for _, s := range content.MSelect {
							contents = append(contents, s.Content)
						}
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
		} else if av.KeyTypeBlock == v.Type {
			dataModel[rowValue.Key.Name+"_created"] = time.Now()
			if nil != v.Block {
				dataModel["entryCreated"] = time.UnixMilli(v.Block.Created)
			}
			dataModel["entryUpdated"] = time.Now()
			if nil != v.Block {
				dataModel["entryUpdated"] = time.UnixMilli(v.Block.Updated)
			}
			dataModel[rowValue.Key.Name] = v.String(true)
		} else {
			dataModel[rowValue.Key.Name] = v.String(true)
		}

		// Database template fields support access to the raw value https://github.com/siyuan-note/siyuan/issues/14903
		dataModel[rowValue.Key.Name+"_raw"] = v

		// Database template fields support access by ID https://github.com/siyuan-note/siyuan/issues/11237
		dataModel["id_mod"].(map[string]any)[rowValue.Key.ID] = dataModel[rowValue.Key.Name]
		dataModel["id_mod_raw"].(map[string]any)[rowValue.Key.ID] = v
	}

	if err = tpl.Execute(buf, dataModel); err != nil {
		logging.LogWarnf("execute template [%s] failed: %s", tplContent, err)
		return
	}
	ret = buf.String()
	return
}

func fillAttributeViewNilValue(value *av.Value, rowID, colID string, typ av.KeyType) {
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
	switch view.LayoutType {
	case av.LayoutTypeTable:
		for i, column := range view.Table.Columns {
			if column.ID == missingKeyID {
				view.Table.Columns = append(view.Table.Columns[:i], view.Table.Columns[i+1:]...)
				changed = true
				break
			}
		}
	case av.LayoutTypeGallery:
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
