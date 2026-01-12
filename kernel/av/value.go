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
	"fmt"
	"math"
	"reflect"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/88250/gulu"
	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/util"
	"golang.org/x/text/language"
	"golang.org/x/text/message"
)

type Value struct {
	ID         string  `json:"id,omitempty"`
	KeyID      string  `json:"keyID,omitempty"`      // 字段 ID
	BlockID    string  `json:"blockID,omitempty"`    // 项目 ID
	Type       KeyType `json:"type,omitempty"`       // 字段类型
	IsDetached bool    `json:"isDetached,omitempty"` // 是否为非绑定块，注意这个字段只能在主键（KeyTypeBlock）上使用，其他类型的值不要使用

	CreatedAt int64 `json:"createdAt,omitempty"`
	UpdatedAt int64 `json:"updatedAt,omitempty"`

	Block    *ValueBlock    `json:"block,omitempty"`
	Text     *ValueText     `json:"text,omitempty"`
	Number   *ValueNumber   `json:"number,omitempty"`
	Date     *ValueDate     `json:"date,omitempty"`
	MSelect  []*ValueSelect `json:"mSelect,omitempty"`
	URL      *ValueURL      `json:"url,omitempty"`
	Email    *ValueEmail    `json:"email,omitempty"`
	Phone    *ValuePhone    `json:"phone,omitempty"`
	MAsset   []*ValueAsset  `json:"mAsset,omitempty"`
	Template *ValueTemplate `json:"template,omitempty"`
	Created  *ValueCreated  `json:"created,omitempty"`
	Updated  *ValueUpdated  `json:"updated,omitempty"`
	Checkbox *ValueCheckbox `json:"checkbox,omitempty"`
	Relation *ValueRelation `json:"relation,omitempty"`
	Rollup   *ValueRollup   `json:"rollup,omitempty"`

	IsRenderAutoFill bool `json:"-"` // 标识是否是渲染阶段自动填充的值，保存数据的时候要删掉
}

func (value *Value) SetUpdatedAt(mills int64) {
	value.UpdatedAt = mills
	if value.CreatedAt == value.UpdatedAt {
		value.UpdatedAt += 1000 // 防止更新时间和创建时间一样
	}
}

const CheckboxCheckedStr = "√"

func (value *Value) String(format bool) string {
	if nil == value {
		return ""
	}

	switch value.Type {
	case KeyTypeBlock:
		if nil == value.Block {
			return ""
		}
		return strings.TrimSpace(value.Block.Content)
	case KeyTypeText:
		if nil == value.Text {
			return ""
		}
		return strings.TrimSpace(value.Text.Content)
	case KeyTypeNumber:
		if nil == value.Number {
			return ""
		}
		if format {
			return value.Number.FormattedContent
		}
		return fmt.Sprintf("%f", value.Number.Content)
	case KeyTypeDate:
		if nil == value.Date {
			return ""
		}
		formatted := NewFormattedValueDate(value.Date.Content, value.Date.Content2, DateFormatNone, value.Date.IsNotTime, value.Date.HasEndDate)
		return formatted.FormattedContent
	case KeyTypeSelect:
		if 1 > len(value.MSelect) {
			return ""
		}
		return value.MSelect[0].Content
	case KeyTypeMSelect:
		if 1 > len(value.MSelect) {
			return ""
		}
		var ret []string
		for _, v := range value.MSelect {
			ret = append(ret, v.Content)
		}
		return strings.Join(ret, " ")
	case KeyTypeURL:
		if nil == value.URL {
			return ""
		}
		return strings.TrimSpace(value.URL.Content)
	case KeyTypeEmail:
		if nil == value.Email {
			return ""
		}
		return strings.TrimSpace(value.Email.Content)
	case KeyTypePhone:
		if nil == value.Phone {
			return ""
		}
		return strings.TrimSpace(value.Phone.Content)
	case KeyTypeMAsset:
		if 1 > len(value.MAsset) {
			return ""
		}
		var ret []string
		for _, v := range value.MAsset {
			ret = append(ret, v.Name+" "+v.Content)
		}
		return strings.Join(ret, " ")
	case KeyTypeTemplate:
		if nil == value.Template {
			return ""
		}
		return strings.TrimSpace(value.Template.Content)
	case KeyTypeCreated:
		if nil == value.Created {
			return ""
		}
		return value.Created.FormattedContent
	case KeyTypeUpdated:
		if nil == value.Updated {
			return ""
		}
		return value.Updated.FormattedContent
	case KeyTypeCheckbox:
		if nil == value.Checkbox {
			return ""
		}
		if value.Checkbox.Checked {
			return CheckboxCheckedStr
		}
		return ""
	case KeyTypeRelation:
		if nil == value.Relation || 1 > len(value.Relation.Contents) {
			return ""
		}
		var ret []string
		for _, v := range value.Relation.Contents {
			ret = append(ret, v.String(format))
		}
		return strings.TrimSpace(strings.Join(ret, ", "))
	case KeyTypeRollup:
		if nil == value.Rollup || 1 > len(value.Rollup.Contents) {
			return ""
		}
		var ret []string
		for _, v := range value.Rollup.Contents {
			ret = append(ret, v.String(format))
		}
		return strings.TrimSpace(strings.Join(ret, ", "))
	default:
		return ""
	}
}

func (value *Value) ToJSONString() string {
	data, err := gulu.JSON.MarshalJSON(value)
	if err != nil {
		return ""
	}
	return string(data)
}

func (value *Value) Clone() (ret *Value) {
	data, err := gulu.JSON.MarshalJSON(value)
	if err != nil {
		return
	}
	err = gulu.JSON.UnmarshalJSON(data, &ret)
	if err != nil {
		return
	}
	return
}

func (value *Value) IsEdited() bool {
	if 1709740800000 > value.CreatedAt {
		// 说明是旧数据，认为都是编辑过的
		return true
	}

	if KeyTypeUpdated == value.Type || KeyTypeCreated == value.Type {
		return true
	}

	if KeyTypeCheckbox == value.Type {
		// 复选框不会为空，即使复选框未勾选，也不算是空，所以不能用下面的 IsEmpty 判断，这里使用更新时间判断是否编辑过 https://github.com/siyuan-note/siyuan/issues/11016
		return value.CreatedAt != value.UpdatedAt
	}

	if !value.IsEmpty() {
		return true
	}
	return value.CreatedAt != value.UpdatedAt
}

func (value *Value) IsBlank() bool {
	if nil == value {
		return true
	}

	switch value.Type {
	case KeyTypeBlock:
		if nil == value.Block {
			return true
		}
		return "" == strings.TrimSpace(value.Block.Content)
	case KeyTypeText:
		if nil == value.Text {
			return true
		}
		return "" == strings.TrimSpace(value.Text.Content)
	case KeyTypeNumber:
		if nil == value.Number {
			return true
		}
		return !value.Number.IsNotEmpty
	case KeyTypeDate:
		if nil == value.Date {
			return true
		}
		return !value.Date.IsNotEmpty
	case KeyTypeSelect:
		if 1 > len(value.MSelect) {
			return true
		}
		return "" == strings.TrimSpace(value.MSelect[0].Content)
	case KeyTypeMSelect:
		return 1 > len(value.MSelect)
	case KeyTypeURL:
		if nil == value.URL {
			return true
		}
		return "" == strings.TrimSpace(value.URL.Content)
	case KeyTypeEmail:
		if nil == value.Email {
			return true
		}
		return "" == strings.TrimSpace(value.Email.Content)
	case KeyTypePhone:
		if nil == value.Phone {
			return true
		}
		return "" == strings.TrimSpace(value.Phone.Content)
	case KeyTypeMAsset:
		return 1 > len(value.MAsset)
	case KeyTypeTemplate:
		if nil == value.Template {
			return true
		}
		return "" == strings.TrimSpace(value.Template.Content)
	case KeyTypeCreated:
		if nil == value.Created {
			return true
		}
		return !value.Created.IsNotEmpty
	case KeyTypeUpdated:
		if nil == value.Updated {
			return true
		}
		return !value.Updated.IsNotEmpty
	case KeyTypeCheckbox:
		if nil == value.Checkbox {
			return true
		}
		return false // 复选框不会为空
	case KeyTypeRelation:
		return 1 > len(value.Relation.Contents)
	case KeyTypeRollup:
		return 1 > len(value.Rollup.Contents)
	}
	return false
}

func (value *Value) IsEmpty() bool {
	if nil == value {
		return true
	}

	switch value.Type {
	case KeyTypeBlock:
		if nil == value.Block {
			return true
		}
		return "" == value.Block.Content
	case KeyTypeText:
		if nil == value.Text {
			return true
		}
		return "" == value.Text.Content
	case KeyTypeNumber:
		if nil == value.Number {
			return true
		}
		return !value.Number.IsNotEmpty
	case KeyTypeDate:
		if nil == value.Date {
			return true
		}
		return !value.Date.IsNotEmpty
	case KeyTypeSelect:
		if 1 > len(value.MSelect) {
			return true
		}
		return "" == value.MSelect[0].Content
	case KeyTypeMSelect:
		return 1 > len(value.MSelect)
	case KeyTypeURL:
		if nil == value.URL {
			return true
		}
		return "" == value.URL.Content
	case KeyTypeEmail:
		if nil == value.Email {
			return true
		}
		return "" == value.Email.Content
	case KeyTypePhone:
		if nil == value.Phone {
			return true
		}
		return "" == value.Phone.Content
	case KeyTypeMAsset:
		return 1 > len(value.MAsset)
	case KeyTypeTemplate:
		if nil == value.Template {
			return true
		}
		return "" == strings.TrimSpace(value.Template.Content)
	case KeyTypeCreated:
		if nil == value.Created {
			return true
		}
		return !value.Created.IsNotEmpty
	case KeyTypeUpdated:
		if nil == value.Updated {
			return true
		}
		return !value.Updated.IsNotEmpty
	case KeyTypeCheckbox:
		if nil == value.Checkbox {
			return true
		}
		return false // 复选框不会为空
	case KeyTypeRelation:
		return 1 > len(value.Relation.Contents)
	case KeyTypeRollup:
		return 1 > len(value.Rollup.Contents)
	}
	return false
}

func (value *Value) SetValByType(typ KeyType, val interface{}) {
	switch typ {
	case KeyTypeBlock:
		value.Block = val.(*ValueBlock)
	case KeyTypeText:
		value.Text = val.(*ValueText)
	case KeyTypeNumber:
		value.Number = val.(*ValueNumber)
	case KeyTypeDate:
		value.Date = val.(*ValueDate)
	case KeyTypeSelect:
		value.MSelect = val.([]*ValueSelect)
	case KeyTypeMSelect:
		value.MSelect = val.([]*ValueSelect)
	case KeyTypeURL:
		value.URL = val.(*ValueURL)
	case KeyTypeEmail:
		value.Email = val.(*ValueEmail)
	case KeyTypePhone:
		value.Phone = val.(*ValuePhone)
	case KeyTypeMAsset:
		value.MAsset = val.([]*ValueAsset)
	case KeyTypeTemplate:
		value.Template = val.(*ValueTemplate)
	case KeyTypeCreated:
		value.Created = val.(*ValueCreated)
	case KeyTypeUpdated:
		value.Updated = val.(*ValueUpdated)
	case KeyTypeCheckbox:
		value.Checkbox = val.(*ValueCheckbox)
	case KeyTypeRelation:
		value.Relation = val.(*ValueRelation)
	case KeyTypeRollup:
		value.Rollup = val.(*ValueRollup)
	}
}

func (value *Value) GetValByType(typ KeyType) (ret interface{}) {
	// 单独处理汇总
	if KeyTypeRollup == value.Type {
		if 1 > len(value.Rollup.Contents) {
			return nil
		}
		return value.Rollup.Contents[0].GetValByType(typ)
	}

	switch typ {
	case KeyTypeBlock:
		return value.Block
	case KeyTypeText:
		return value.Text
	case KeyTypeNumber:
		return value.Number
	case KeyTypeDate:
		return value.Date
	case KeyTypeSelect:
		return value.MSelect
	case KeyTypeMSelect:
		return value.MSelect
	case KeyTypeURL:
		return value.URL
	case KeyTypeEmail:
		return value.Email
	case KeyTypePhone:
		return value.Phone
	case KeyTypeMAsset:
		return value.MAsset
	case KeyTypeTemplate:
		return value.Template
	case KeyTypeCreated:
		return value.Created
	case KeyTypeUpdated:
		return value.Updated
	case KeyTypeCheckbox:
		return value.Checkbox
	case KeyTypeRelation:
		return value.Relation
	case KeyTypeRollup:
		return value.Rollup
	}
	return
}

type ValueBlock struct {
	ID      string `json:"id,omitempty"` // 绑定的块 ID，非绑定块时为空
	Icon    string `json:"icon,omitempty"`
	Content string `json:"content"`
	Created int64  `json:"created,omitempty"`
	Updated int64  `json:"updated,omitempty"`
}

type ValueText struct {
	Content string `json:"content"`
}

type ValueNumber struct {
	Content          float64      `json:"content"`
	IsNotEmpty       bool         `json:"isNotEmpty"`
	Format           NumberFormat `json:"format"`
	FormattedContent string       `json:"formattedContent"`
}

type NumberFormat string

const (
	NumberFormatNone    NumberFormat = ""
	NumberFormatCommas  NumberFormat = "commas"
	NumberFormatPercent NumberFormat = "percent"

	NumberFormatUSD NumberFormat = "USD" // 美元
	NumberFormatCNY NumberFormat = "CNY" // 人民币
	NumberFormatEUR NumberFormat = "EUR" // 欧元
	NumberFormatGBP NumberFormat = "GBP" // 英镑
	NumberFormatJPY NumberFormat = "JPY" // 日元
	NumberFormatRUB NumberFormat = "RUB" // 卢布
	NumberFormatINR NumberFormat = "INR" // 卢比
	NumberFormatKRW NumberFormat = "KRW" // 韩元
	NumberFormatTRY NumberFormat = "TRY" // 土耳其里拉
	NumberFormatCAD NumberFormat = "CAD" // 加拿大元
	NumberFormatCHF NumberFormat = "CHF" // 瑞士法郎
	NumberFormatTHB NumberFormat = "THB" // 泰铢
	NumberFormatAUD NumberFormat = "AUD" // 澳大利亚元
	NumberFormatHKD NumberFormat = "HKD" // 港币
	NumberFormatTWD NumberFormat = "TWD" // 新台币
	NumberFormatMOP NumberFormat = "MOP" // 澳门币
	NumberFormatSGD NumberFormat = "SGD" // 新加坡元
	NumberFormatNZD NumberFormat = "NZD" // 新西兰元
	NumberFormatILS NumberFormat = "ILS" // 以色列新谢克尔
)

func NewFormattedValueNumber(content float64, format NumberFormat) (ret *ValueNumber) {
	ret = &ValueNumber{
		Content:          content,
		IsNotEmpty:       true,
		Format:           format,
		FormattedContent: fmt.Sprintf("%f", content),
	}

	ret.FormattedContent = formatNumber(content, format)

	switch format {
	case NumberFormatNone:
		s := fmt.Sprintf("%.5f", content)
		ret.FormattedContent = strings.TrimRight(strings.TrimRight(s, "0"), ".")
	}
	return
}

func (number *ValueNumber) FormatNumber() {
	if !number.IsNotEmpty {
		number.FormattedContent = ""
	} else {
		number.FormattedContent = formatNumber(number.Content, number.Format)
	}
}

func formatNumber(content float64, format NumberFormat) string {
	switch format {
	case NumberFormatNone:
		return strconv.FormatFloat(content, 'f', -1, 64)
	case NumberFormatCommas:
		p := message.NewPrinter(language.English)
		s := p.Sprintf("%f", content)
		return strings.TrimRight(strings.TrimRight(s, "0"), ".")
	case NumberFormatPercent:
		s := fmt.Sprintf("%.2f", content*100)
		return strings.TrimRight(strings.TrimRight(s, "0"), ".") + "%"
	case NumberFormatUSD, "usDollar":
		p := message.NewPrinter(language.English)
		return p.Sprintf("$%.2f", content)
	case NumberFormatCNY, "yuan":
		p := message.NewPrinter(language.Chinese)
		return p.Sprintf("CN¥%.2f", content)
	case NumberFormatEUR, "euro":
		p := message.NewPrinter(language.German)
		return p.Sprintf("€%.2f", content)
	case NumberFormatGBP, "pound":
		p := message.NewPrinter(language.English)
		return p.Sprintf("£%.2f", content)
	case NumberFormatJPY, "yen":
		p := message.NewPrinter(language.Japanese)
		return p.Sprintf("¥%.0f", content)
	case NumberFormatRUB, "ruble":
		p := message.NewPrinter(language.Russian)
		return p.Sprintf("₽%.2f", content)
	case NumberFormatINR, "rupee":
		p := message.NewPrinter(language.Hindi)
		return p.Sprintf("₹%.2f", content)
	case NumberFormatKRW, "won":
		p := message.NewPrinter(language.Korean)
		return p.Sprintf("₩%.0f", content)
	case NumberFormatTRY, "turkishLira":
		p := message.NewPrinter(language.Turkish)
		return p.Sprintf("₺%.2f", content)
	case NumberFormatCAD, "canadianDollar":
		p := message.NewPrinter(language.English)
		return p.Sprintf("CA$%.2f", content)
	case NumberFormatCHF, "franc":
		p := message.NewPrinter(language.French)
		return p.Sprintf("CHF%.2f", content)
	case NumberFormatTHB:
		p := message.NewPrinter(language.Thai)
		return p.Sprintf("฿%.2f", content)
	case NumberFormatAUD:
		p := message.NewPrinter(language.English)
		return p.Sprintf("A$%.2f", content)
	case NumberFormatHKD:
		p := message.NewPrinter(language.English)
		return p.Sprintf("HK$%.2f", content)
	case NumberFormatTWD:
		p := message.NewPrinter(language.Chinese)
		return p.Sprintf("NT$%.2f", content)
	case NumberFormatMOP:
		p := message.NewPrinter(language.Chinese)
		return p.Sprintf("MOP$%.2f", content)
	case NumberFormatSGD:
		p := message.NewPrinter(language.English)
		return p.Sprintf("S$%.2f", content)
	case NumberFormatNZD:
		p := message.NewPrinter(language.English)
		return p.Sprintf("NZ$%.2f", content)
	case NumberFormatILS:
		p := message.NewPrinter(language.Hebrew)
		return p.Sprintf("ILS₪%.2f", content)
	default:
		return strconv.FormatFloat(content, 'f', -1, 64)
	}
}

type ValueDate struct {
	Content          int64  `json:"content"`
	IsNotEmpty       bool   `json:"isNotEmpty"`
	HasEndDate       bool   `json:"hasEndDate"`
	IsNotTime        bool   `json:"isNotTime"`
	Content2         int64  `json:"content2"`
	IsNotEmpty2      bool   `json:"isNotEmpty2"`
	FormattedContent string `json:"formattedContent"`
}

type DateFormat string

const (
	DateFormatNone     DateFormat = ""
	DateFormatDuration DateFormat = "duration"
)

func NewFormattedValueDate(content, content2 int64, format DateFormat, isNotTime, hasEndDate bool) (ret *ValueDate) {
	var formatted string
	contentTime := time.UnixMilli(content)
	if 0 == content || contentTime.IsZero() {
		ret = &ValueDate{
			Content:          content,
			Content2:         content2,
			HasEndDate:       false,
			IsNotTime:        isNotTime,
			FormattedContent: formatted,
		}
		return
	}

	if isNotTime {
		formatted = contentTime.Format("2006-01-02")
	} else {
		formatted = contentTime.Format("2006-01-02 15:04")
	}

	content2Time := time.UnixMilli(content2)
	if hasEndDate {
		var formattedContent2 string
		if isNotTime {
			formattedContent2 = content2Time.Format("2006-01-02")
		} else {
			formattedContent2 = content2Time.Format("2006-01-02 15:04")
		}
		if !content2Time.IsZero() {
			formatted += " → " + formattedContent2
		}
	}
	switch format {
	case DateFormatNone:
	case DateFormatDuration:
		t1 := time.UnixMilli(content)
		t2 := time.UnixMilli(content2)
		formatted = util.HumanizeRelTime(t1, t2, util.Lang)
	}
	ret = &ValueDate{
		Content:          content,
		Content2:         content2,
		IsNotEmpty:       true,
		IsNotEmpty2:      !content2Time.IsZero(),
		HasEndDate:       hasEndDate,
		IsNotTime:        isNotTime,
		FormattedContent: formatted,
	}
	return
}

// RoundUp rounds like 12.3416 -> 12.35
func RoundUp(val float64, precision int) float64 {
	return math.Ceil(val*(math.Pow10(precision))) / math.Pow10(precision)
}

// RoundDown rounds like 12.3496 -> 12.34
func RoundDown(val float64, precision int) float64 {
	return math.Floor(val*(math.Pow10(precision))) / math.Pow10(precision)
}

// Round rounds to nearest like 12.3456 -> 12.35
func Round(val float64, precision int) float64 {
	return math.Round(val*(math.Pow10(precision))) / math.Pow10(precision)
}

type ValueSelect struct {
	Content string `json:"content"`
	Color   string `json:"color"` // 1-14
}

func MSelectRemoveOption(mSelect []*ValueSelect, opt string) (ret []*ValueSelect) {
	for _, s := range mSelect {
		if s.Content != opt {
			ret = append(ret, s)
		}
	}
	return
}

func MSelectExistOption(mSelect []*ValueSelect, opt string) bool {
	for _, s := range mSelect {
		if s.Content == opt {
			return true
		}
	}
	return false
}

type ValueURL struct {
	Content string `json:"content"`
}

type ValueEmail struct {
	Content string `json:"content"`
}

type ValuePhone struct {
	Content string `json:"content"`
}

type AssetType string

const (
	AssetTypeFile  = "file" // 链接也使用文件类型
	AssetTypeImage = "image"
)

type ValueAsset struct {
	Type    AssetType `json:"type"`
	Name    string    `json:"name"`
	Content string    `json:"content"`
}

type ValueTemplate struct {
	Content string `json:"content"`
}

type ValueCreated struct {
	Content          int64  `json:"content"`
	IsNotEmpty       bool   `json:"isNotEmpty"`
	Content2         int64  `json:"content2"`
	IsNotEmpty2      bool   `json:"isNotEmpty2"`
	FormattedContent string `json:"formattedContent"`
}

type CreatedFormat string

const (
	CreatedFormatNone     CreatedFormat = "" // 2006-01-02 15:04
	CreatedFormatDuration CreatedFormat = "duration"
)

func NewFormattedValueCreated(content, content2 int64, format CreatedFormat, isNotTime bool) (ret *ValueCreated) {
	var formatted string
	if isNotTime {
		formatted = time.UnixMilli(content).Format("2006-01-02")
	} else {
		formatted = time.UnixMilli(content).Format("2006-01-02 15:04")
	}

	if 0 < content2 {
		formatted += " → " + time.UnixMilli(content2).Format("2006-01-02 15:04")
	}
	switch format {
	case CreatedFormatNone:
	case CreatedFormatDuration:
		t1 := time.UnixMilli(content)
		t2 := time.UnixMilli(content2)
		formatted = util.HumanizeRelTime(t1, t2, util.Lang)
	}
	ret = &ValueCreated{
		Content:          content,
		Content2:         content2,
		FormattedContent: formatted,
	}
	return
}

type ValueUpdated struct {
	Content          int64  `json:"content"`
	IsNotEmpty       bool   `json:"isNotEmpty"`
	Content2         int64  `json:"content2"`
	IsNotEmpty2      bool   `json:"isNotEmpty2"`
	FormattedContent string `json:"formattedContent"`
}

type UpdatedFormat string

const (
	UpdatedFormatNone     UpdatedFormat = "" // 2006-01-02 15:04
	UpdatedFormatDuration UpdatedFormat = "duration"
)

func NewFormattedValueUpdated(content, content2 int64, format UpdatedFormat, isNotTime bool) (ret *ValueUpdated) {
	var formatted string
	if isNotTime {
		formatted = time.UnixMilli(content).Format("2006-01-02")
	} else {
		formatted = time.UnixMilli(content).Format("2006-01-02 15:04")
	}

	if 0 < content2 {
		formatted += " → " + time.UnixMilli(content2).Format("2006-01-02 15:04")
	}
	switch format {
	case UpdatedFormatNone:
	case UpdatedFormatDuration:
		t1 := time.UnixMilli(content)
		t2 := time.UnixMilli(content2)
		formatted = util.HumanizeRelTime(t1, t2, util.Lang)
	}
	ret = &ValueUpdated{
		Content:          content,
		Content2:         content2,
		FormattedContent: formatted,
	}
	return
}

type ValueCheckbox struct {
	Checked bool `json:"checked"`
}

type ValueRelation struct {
	BlockIDs []string `json:"blockIDs"`
	Contents []*Value `json:"contents"`
}

type ValueRollup struct {
	Contents []*Value `json:"contents"`
}

func (r *ValueRollup) BuildContents(keyValues []*KeyValues, destKey *Key, relationVal *Value, calc *RollupCalc, furtherCollection Collection) {
	r.Contents = nil
	for _, blockID := range relationVal.Relation.BlockIDs {
		destVal := GetValue(keyValues, destKey.ID, blockID)
		if nil != furtherCollection && (KeyTypeTemplate == destKey.Type || KeyTypeUpdated == destKey.Type || KeyTypeCreated == destKey.Type) {
			destVal = furtherCollection.GetValue(blockID, destKey.ID)
		}

		if nil == destVal {
			if KeyTypeCheckbox == destKey.Type {
				// 没有编辑过复选框的时候没有值，没有值等同于未选中，所以这里补一个未选中的值 https://github.com/siyuan-note/siyuan/issues/15858
				defaultVal := GetAttributeViewDefaultValue(ast.NewNodeID(), destKey.ID, blockID, destKey.Type, false)
				r.Contents = append(r.Contents, defaultVal)
			}
			continue
		}

		if val := destVal.GetValByType(destKey.Type); nil == val || reflect.ValueOf(val).IsNil() {
			// 目标字段因为修改类型导致空值
			continue
		}

		if KeyTypeNumber == destKey.Type {
			destVal.Number.Format = destKey.NumberFormat
			destVal.Number.FormatNumber()
		}

		r.Contents = append(r.Contents, destVal.Clone())
	}

	r.calcContents(calc, destKey)
}

func (r *ValueRollup) calcContents(calc *RollupCalc, destKey *Key) {
	if nil == calc {
		return
	}

	switch calc.Operator {
	case CalcOperatorNone:
	case CalcOperatorUniqueValues:
		uniqueValues := map[string]bool{}
		for _, content := range r.Contents {
			switch content.Type {
			case KeyTypeRelation:
				var newRelationContents []*Value
				for _, relationVal := range content.Relation.Contents {
					key := relationVal.String(true)
					if !uniqueValues[key] {
						uniqueValues[key] = true
						newRelationContents = append(newRelationContents, relationVal)
					}
				}
				content.Relation.Contents = newRelationContents
			case KeyTypeMSelect:
				var newMSelect []*ValueSelect
				for _, mSelect := range content.MSelect {
					if !uniqueValues[mSelect.Content] {
						uniqueValues[mSelect.Content] = true
						newMSelect = append(newMSelect, mSelect)
					}
				}
				content.MSelect = newMSelect
			case KeyTypeMAsset:
				var newMAsset []*ValueAsset
				for _, mAsset := range content.MAsset {
					if !uniqueValues[mAsset.Content] {
						uniqueValues[mAsset.Content] = true
						newMAsset = append(newMAsset, mAsset)
					}
				}
				content.MAsset = newMAsset
			}
		}
	case CalcOperatorCountAll:
		r.Contents = []*Value{{Type: KeyTypeNumber, Number: NewFormattedValueNumber(float64(len(r.Contents)), NumberFormatNone)}}
	case CalcOperatorCountValues:
		r.Contents = []*Value{{Type: KeyTypeNumber, Number: NewFormattedValueNumber(float64(len(r.Contents)), NumberFormatNone)}}
	case CalcOperatorCountUniqueValues:
		countUniqueValues := 0
		uniqueValues := map[string]bool{}
		for _, v := range r.Contents {
			if _, ok := uniqueValues[v.String(true)]; !ok {
				uniqueValues[v.String(true)] = true
				countUniqueValues++
			}
		}
		r.Contents = []*Value{{Type: KeyTypeNumber, Number: NewFormattedValueNumber(float64(countUniqueValues), NumberFormatNone)}}
	case CalcOperatorCountEmpty:
		countEmpty := 0
		for _, v := range r.Contents {
			if "" == v.String(true) {
				countEmpty++
			}
		}
		r.Contents = []*Value{{Type: KeyTypeNumber, Number: NewFormattedValueNumber(float64(countEmpty), NumberFormatNone)}}
	case CalcOperatorCountNotEmpty:
		countNonEmpty := 0
		for _, v := range r.Contents {
			if "" != v.String(true) {
				countNonEmpty++
			}
		}
		r.Contents = []*Value{{Type: KeyTypeNumber, Number: NewFormattedValueNumber(float64(countNonEmpty), NumberFormatNone)}}
	case CalcOperatorPercentEmpty:
		countEmpty := 0
		for _, v := range r.Contents {
			if "" == v.String(true) {
				countEmpty++
			}
		}
		if 0 < len(r.Contents) {
			r.Contents = []*Value{{Type: KeyTypeNumber, Number: NewFormattedValueNumber(float64(countEmpty)/float64(len(r.Contents)), NumberFormatPercent)}}
		}
	case CalcOperatorPercentNotEmpty:
		countNonEmpty := 0
		for _, v := range r.Contents {
			if "" != v.String(true) {
				countNonEmpty++
			}
		}
		if 0 < len(r.Contents) {
			r.Contents = []*Value{{Type: KeyTypeNumber, Number: NewFormattedValueNumber(float64(countNonEmpty)/float64(len(r.Contents)), NumberFormatPercent)}}
		}
	case CalcOperatorPercentUniqueValues:
		countUniqueValues := 0
		uniqueValues := map[string]bool{}
		for _, v := range r.Contents {
			if _, ok := uniqueValues[v.String(true)]; !ok {
				uniqueValues[v.String(true)] = true
				countUniqueValues++
			}
		}
		if 0 < len(r.Contents) {
			r.Contents = []*Value{{Type: KeyTypeNumber, Number: NewFormattedValueNumber(float64(countUniqueValues)/float64(len(r.Contents)), NumberFormatPercent)}}
		}
	case CalcOperatorSum:
		sum := 0.0
		for _, v := range r.Contents {
			if KeyTypeNumber == v.Type && nil != v.Number && v.Number.IsNotEmpty {
				sum += v.Number.Content
			} else {
				content := v.String(false)
				f, _ := util.Convert2Float(content)
				sum += f
			}
		}
		r.Contents = []*Value{{Type: KeyTypeNumber, Number: NewFormattedValueNumber(sum, destKey.NumberFormat)}}
	case CalcOperatorAverage:
		sum := 0.0
		count := 0
		for _, v := range r.Contents {
			if KeyTypeNumber == v.Type && nil != v.Number && v.Number.IsNotEmpty {
				sum += v.Number.Content
				count++
			} else {
				content := v.String(false)
				f, _ := util.Convert2Float(content)
				sum += f
				count++
			}
		}
		if 0 < count {
			r.Contents = []*Value{{Type: KeyTypeNumber, Number: NewFormattedValueNumber(sum/float64(count), destKey.NumberFormat)}}
		}
	case CalcOperatorMedian:
		var numbers []float64
		for _, v := range r.Contents {
			if KeyTypeNumber == v.Type && nil != v.Number && v.Number.IsNotEmpty {
				numbers = append(numbers, v.Number.Content)
			} else {
				content := v.String(false)
				f, _ := util.Convert2Float(content)
				numbers = append(numbers, f)
			}
		}
		sort.Float64s(numbers)
		if 0 < len(numbers) {
			if 0 == len(numbers)%2 {
				r.Contents = []*Value{{Type: KeyTypeNumber, Number: NewFormattedValueNumber((numbers[len(numbers)/2-1]+numbers[len(numbers)/2])/2, destKey.NumberFormat)}}
			} else {
				r.Contents = []*Value{{Type: KeyTypeNumber, Number: NewFormattedValueNumber(numbers[len(numbers)/2], destKey.NumberFormat)}}
			}
		}
	case CalcOperatorMin:
		minVal := math.MaxFloat64
		for _, v := range r.Contents {
			if KeyTypeNumber == v.Type && nil != v.Number && v.Number.IsNotEmpty {
				if v.Number.Content < minVal {
					minVal = v.Number.Content
				}
			} else {
				content := v.String(false)
				f, _ := util.Convert2Float(content)
				if f < minVal {
					minVal = f
				}
			}
		}
		if math.MaxFloat64 != minVal {
			r.Contents = []*Value{{Type: KeyTypeNumber, Number: NewFormattedValueNumber(minVal, destKey.NumberFormat)}}
		}
	case CalcOperatorMax:
		maxVal := -math.MaxFloat64
		for _, v := range r.Contents {
			if KeyTypeNumber == v.Type && nil != v.Number && v.Number.IsNotEmpty {
				if v.Number.Content > maxVal {
					maxVal = v.Number.Content
				}
			} else {
				content := v.String(false)
				f, _ := util.Convert2Float(content)
				if f > maxVal {
					maxVal = f
				}
			}
		}
		if -math.MaxFloat64 != maxVal {
			r.Contents = []*Value{{Type: KeyTypeNumber, Number: NewFormattedValueNumber(maxVal, destKey.NumberFormat)}}
		}
	case CalcOperatorRange:
		if 2 > len(r.Contents) {
			return
		}

		minVal := math.MaxFloat64
		maxVal := -math.MaxFloat64
		earliest := int64(0)
		latest := int64(0)
		var isNotTime, hasEndDate bool
		for _, v := range r.Contents {
			if KeyTypeNumber == v.Type && nil != v.Number && v.Number.IsNotEmpty {
				if v.Number.Content < minVal {
					minVal = v.Number.Content
				}
				if v.Number.Content > maxVal {
					maxVal = v.Number.Content
				}
			} else if KeyTypeDate == v.Type && nil != v.Date && v.Date.IsNotEmpty {
				if 0 == earliest || v.Date.Content < earliest {
					earliest = v.Date.Content
					isNotTime = v.Date.IsNotTime
					hasEndDate = v.Date.HasEndDate
				}
				if 0 == latest || v.Date.Content > latest {
					latest = v.Date.Content
					isNotTime = v.Date.IsNotTime
					hasEndDate = v.Date.HasEndDate
				}
			} else if KeyTypeUpdated == v.Type && nil != v.Updated && v.Updated.IsNotEmpty {
				if 0 == earliest || v.Updated.Content < earliest {
					earliest = v.Updated.Content
					isNotTime = true
					hasEndDate = false
				}
				if 0 == latest || v.Updated.Content > latest {
					latest = v.Updated.Content
					isNotTime = true
					hasEndDate = false
				}
			} else if KeyTypeCreated == v.Type && nil != v.Created && v.Created.IsNotEmpty {
				if 0 == earliest || v.Created.Content < earliest {
					earliest = v.Created.Content
					isNotTime = true
					hasEndDate = false
				}
				if 0 == latest || v.Created.Content > latest {
					latest = v.Created.Content
					isNotTime = true
					hasEndDate = false
				}
			} else {
				content := v.String(false)
				f, _ := util.Convert2Float(content)
				if f < minVal {
					minVal = f
				}
				if f > maxVal {
					maxVal = f
				}
			}
		}

		typ := r.Contents[0].Type
		switch typ {
		case KeyTypeNumber:
			if math.MaxFloat64 != minVal && -math.MaxFloat64 != maxVal {
				r.Contents = []*Value{{Type: KeyTypeNumber, Number: NewFormattedValueNumber(maxVal-minVal, destKey.NumberFormat)}}
			}
		case KeyTypeDate:
			if 0 != earliest && 0 != latest {
				r.Contents = []*Value{{Type: KeyTypeDate, Date: NewFormattedValueDate(earliest, latest, DateFormatDuration, isNotTime, hasEndDate)}}
			}
		case KeyTypeUpdated:
			if 0 != earliest && 0 != latest {
				isNotTime = false
				if nil != destKey.Updated {
					isNotTime = !destKey.Updated.IncludeTime
				}

				r.Contents = []*Value{{Type: KeyTypeUpdated, Updated: NewFormattedValueUpdated(earliest, latest, UpdatedFormatDuration, isNotTime)}}
			}
		case KeyTypeCreated:
			if 0 != earliest && 0 != latest {
				isNotTime = false
				if nil != destKey.Created {
					isNotTime = !destKey.Created.IncludeTime
				}

				r.Contents = []*Value{{Type: KeyTypeCreated, Created: NewFormattedValueCreated(earliest, latest, CreatedFormatDuration, isNotTime)}}
			}
		default:
			if math.MaxFloat64 != minVal && -math.MaxFloat64 != maxVal {
				r.Contents = []*Value{{Type: KeyTypeNumber, Number: NewFormattedValueNumber(maxVal-minVal, destKey.NumberFormat)}}
			}
		}
	case CalcOperatorEarliest:
		if 1 > len(r.Contents) {
			return
		}

		earliest := int64(0)
		var isNotTime, hasEndDate bool
		for _, v := range r.Contents {
			if KeyTypeDate == v.Type && nil != v.Date && v.Date.IsNotEmpty {
				if 0 == earliest || v.Date.Content < earliest {
					earliest = v.Date.Content
					isNotTime = v.Date.IsNotTime
					hasEndDate = v.Date.HasEndDate
				}
			} else if KeyTypeUpdated == v.Type && nil != v.Updated && v.Updated.IsNotEmpty {
				if 0 == earliest || v.Updated.Content < earliest {
					earliest = v.Updated.Content
					isNotTime = true
					hasEndDate = false
				}
			} else if KeyTypeCreated == v.Type && nil != v.Created && v.Created.IsNotEmpty {
				if 0 == earliest || v.Created.Content < earliest {
					earliest = v.Created.Content
					isNotTime = true
					hasEndDate = false
				}
			}
		}

		typ := r.Contents[0].Type
		switch typ {
		case KeyTypeDate:
			if 0 != earliest {
				r.Contents = []*Value{{Type: KeyTypeDate, Date: NewFormattedValueDate(earliest, 0, DateFormatNone, isNotTime, hasEndDate)}}
			}
		case KeyTypeUpdated:
			if 0 != earliest {
				isNotTime = false
				if nil != destKey.Updated {
					isNotTime = !destKey.Updated.IncludeTime
				}

				r.Contents = []*Value{{Type: KeyTypeUpdated, Updated: NewFormattedValueUpdated(earliest, 0, UpdatedFormatNone, isNotTime)}}
			}
		case KeyTypeCreated:
			if 0 != earliest {
				isNotTime = false
				if nil != destKey.Created {
					isNotTime = !destKey.Created.IncludeTime
				}

				r.Contents = []*Value{{Type: KeyTypeCreated, Created: NewFormattedValueCreated(earliest, 0, CreatedFormatNone, isNotTime)}}
			}
		}
	case CalcOperatorLatest:
		if 1 > len(r.Contents) {
			return
		}

		latest := int64(0)
		var isNotTime, hasEndDate bool
		for _, v := range r.Contents {
			if KeyTypeDate == v.Type && nil != v.Date && v.Date.IsNotEmpty {
				if 0 == latest || latest < v.Date.Content {
					latest = v.Date.Content
					isNotTime = v.Date.IsNotTime
					hasEndDate = v.Date.HasEndDate
				}
			} else if KeyTypeUpdated == v.Type && nil != v.Updated && v.Updated.IsNotEmpty {
				if 0 == latest || latest < v.Updated.Content {
					latest = v.Updated.Content
					isNotTime = true
					hasEndDate = false
				}
			} else if KeyTypeCreated == v.Type && nil != v.Created && v.Created.IsNotEmpty {
				if 0 == latest || latest < v.Created.Content {
					latest = v.Created.Content
					isNotTime = true
					hasEndDate = false
				}
			}
		}

		typ := r.Contents[0].Type
		switch typ {
		case KeyTypeDate:
			if 0 != latest {
				r.Contents = []*Value{{Type: KeyTypeDate, Date: NewFormattedValueDate(latest, 0, DateFormatNone, isNotTime, hasEndDate)}}
			}
		case KeyTypeUpdated:
			if 0 != latest {
				isNotTime = false
				if nil != destKey.Updated {
					isNotTime = !destKey.Updated.IncludeTime
				}
				r.Contents = []*Value{{Type: KeyTypeUpdated, Updated: NewFormattedValueUpdated(latest, 0, UpdatedFormatNone, isNotTime)}}
			}
		case KeyTypeCreated:
			if 0 != latest {
				isNotTime = false
				if nil != destKey.Created {
					isNotTime = !destKey.Created.IncludeTime
				}

				r.Contents = []*Value{{Type: KeyTypeCreated, Created: NewFormattedValueCreated(latest, 0, CreatedFormatNone, isNotTime)}}
			}
		}
	case CalcOperatorChecked:
		countChecked := 0
		for _, v := range r.Contents {
			if nil != v.Checkbox {
				if v.Checkbox.Checked {
					countChecked++
				}
			}
		}
		r.Contents = []*Value{{Type: KeyTypeNumber, Number: NewFormattedValueNumber(float64(countChecked), NumberFormatNone)}}
	case CalcOperatorUnchecked:
		countUnchecked := 0
		for _, v := range r.Contents {
			if nil != v.Checkbox {
				if !v.Checkbox.Checked {
					countUnchecked++
				}
			}
		}
		r.Contents = []*Value{{Type: KeyTypeNumber, Number: NewFormattedValueNumber(float64(countUnchecked), NumberFormatNone)}}
	case CalcOperatorPercentChecked:
		countChecked := 0
		for _, v := range r.Contents {
			if nil != v.Checkbox {
				if v.Checkbox.Checked {
					countChecked++
				}
			}
		}
		if 0 < len(r.Contents) {
			r.Contents = []*Value{{Type: KeyTypeNumber, Number: NewFormattedValueNumber(float64(countChecked*100/len(r.Contents)), NumberFormatNone)}}
		}
	case CalcOperatorPercentUnchecked:
		countUnchecked := 0
		for _, v := range r.Contents {
			if nil != v.Checkbox {
				if !v.Checkbox.Checked {
					countUnchecked++
				}
			}
		}
		if 0 < len(r.Contents) {
			r.Contents = []*Value{{Type: KeyTypeNumber, Number: NewFormattedValueNumber(float64(countUnchecked*100/len(r.Contents)), NumberFormatNone)}}
		}
	}
}

func GetAttributeViewDefaultValue(valueID, keyID, blockID string, typ KeyType, keyDateIsTime bool) (ret *Value) {
	if "" == valueID {
		valueID = ast.NewNodeID()
	}

	ret = &Value{ID: valueID, KeyID: keyID, BlockID: blockID, Type: typ}

	createdStr := valueID[:len("20060102150405")]
	created, parseErr := time.ParseInLocation("20060102150405", createdStr, time.Local)
	if nil == parseErr {
		ret.CreatedAt = created.UnixMilli()
	} else {
		ret.CreatedAt = time.Now().UnixMilli()
	}
	if 0 == ret.UpdatedAt {
		ret.UpdatedAt = ret.CreatedAt
	}

	switch typ {
	case KeyTypeBlock:
		ret.Block = &ValueBlock{Created: ret.CreatedAt, Updated: ret.UpdatedAt}
	case KeyTypeText:
		ret.Text = &ValueText{}
	case KeyTypeNumber:
		ret.Number = &ValueNumber{}
	case KeyTypeDate:
		ret.Date = &ValueDate{IsNotTime: !keyDateIsTime}
	case KeyTypeSelect:
		ret.MSelect = []*ValueSelect{}
	case KeyTypeMSelect:
		ret.MSelect = []*ValueSelect{}
	case KeyTypeURL:
		ret.URL = &ValueURL{}
	case KeyTypeEmail:
		ret.Email = &ValueEmail{}
	case KeyTypePhone:
		ret.Phone = &ValuePhone{}
	case KeyTypeMAsset:
		ret.MAsset = []*ValueAsset{}
	case KeyTypeTemplate:
		ret.Template = &ValueTemplate{}
	case KeyTypeCreated:
		ret.Created = &ValueCreated{}
	case KeyTypeUpdated:
		ret.Updated = &ValueUpdated{}
	case KeyTypeCheckbox:
		ret.Checkbox = &ValueCheckbox{}
	case KeyTypeRelation:
		ret.Relation = &ValueRelation{}
	case KeyTypeRollup:
		ret.Rollup = &ValueRollup{}
	}
	return
}
