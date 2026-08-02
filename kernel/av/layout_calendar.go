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

import "github.com/88250/lute/ast"

type ViewMode int

const (
	ViewModeMonth ViewMode = iota
	ViewModeWeek
	ViewModeDay
	ViewModeSchedule
	ViewModeYear
	ViewModeFiveDay
)

type WeekStart int

const (
	WeekStartSunday WeekStart = iota
	WeekStartMonday
)

// CalendarNewItemTarget 描述日历视图新建条目时创建的目标。
//   - 空字符串是历史视图的零值，等同于 CalendarNewItemTargetRow（只建游离行，不建文档），
//     这样升级到本版本的既有视图行为保持不变。
//   - CalendarNewItemTargetDocument 表示每个条目都是一篇真正的 SiYuan 文档（页面）。
type CalendarNewItemTarget = string

const (
	CalendarNewItemTargetRow      CalendarNewItemTarget = "row"
	CalendarNewItemTargetDocument CalendarNewItemTarget = "document"
)

// IsCalendarNewItemTargetValid 校验 setAttrViewCalendarNewItemTarget 的取值。
// 允许空字符串，表示回到历史默认（只建行）。
func IsCalendarNewItemTargetValid(target string) bool {
	switch target {
	case "", CalendarNewItemTargetRow, CalendarNewItemTargetDocument:
		return true
	}
	return false
}

type LayoutCalendar struct {
	*BaseLayout

	DateFieldID string                   `json:"dateFieldID"`
	ViewMode    ViewMode                 `json:"viewMode"`
	WeekStart   WeekStart                `json:"weekStart"`
	Fields      []*ViewCalendarCardField `json:"fields"`
	// NewItemTarget 记录该视图新建条目时是创建文档（页面）还是只创建游离行。
	// 零值 "" 表示历史视图，只建行。
	NewItemTarget CalendarNewItemTarget `json:"newItemTarget,omitempty"`
	FieldMapping  *CalendarFieldMapping `json:"fieldMapping"`
}

type CalendarFieldMapping struct {
	RecurrenceFieldID  string `json:"recurrenceFieldID,omitempty"`
	ExceptionFieldID   string `json:"exceptionFieldID,omitempty"`
	LocationFieldID    string `json:"locationFieldID,omitempty"`
	DescriptionFieldID string `json:"descriptionFieldID,omitempty"`
	ColorFieldID       string `json:"colorFieldID,omitempty"`
}

type ViewCalendarCardField struct {
	*BaseField
}

type Calendar struct {
	*BaseInstance

	DateFieldID   string                `json:"dateFieldID"`
	ViewMode      ViewMode              `json:"viewMode"`
	WeekStart     WeekStart             `json:"weekStart"`
	NewItemTarget CalendarNewItemTarget `json:"newItemTarget"`
	Fields        []*CalendarField      `json:"fields"`
	Cards         []*CalendarCard       `json:"cards"`
	CardCount     int                   `json:"cardCount"`
	FieldMapping  *CalendarFieldMapping `json:"fieldMapping"`
}

type CalendarCard struct {
	ID     string                `json:"id"`
	Values []*CalendarFieldValue `json:"values"`
}

type CalendarField struct {
	*BaseInstanceField
}

type CalendarFieldValue struct {
	*BaseValue
}

func NewLayoutCalendar() (ret *LayoutCalendar) {
	return &LayoutCalendar{
		BaseLayout: &BaseLayout{
			Spec:      CurrentSpec,
			ID:        ast.NewNodeID(),
			ShowIcon:  true,
			WrapField: false,
		},
		ViewMode: ViewModeMonth,
		Fields:   []*ViewCalendarCardField{},
		// 新建的日历视图默认「每个条目是一个页面」；磁盘上已有的视图解析出来是零值 ""，保持只建行。
		NewItemTarget: CalendarNewItemTargetDocument,
	}
}

func (card *CalendarCard) GetID() string {
	return card.ID
}

func (card *CalendarCard) GetBlockValue() (ret *Value) {
	for _, v := range card.Values {
		if KeyTypeBlock == v.ValueType {
			ret = v.Value
			break
		}
	}
	return
}

func (card *CalendarCard) GetValues() (ret []*Value) {
	ret = []*Value{}
	for _, v := range card.Values {
		ret = append(ret, v.Value)
	}
	return
}

func (card *CalendarCard) GetValue(keyID string) (ret *Value) {
	for _, value := range card.Values {
		if nil != value.Value && keyID == value.Value.KeyID {
			ret = value.Value
			break
		}
	}
	return
}

func (calendar *Calendar) GetItems() (ret []Item) {
	ret = []Item{}
	for _, card := range calendar.Cards {
		ret = append(ret, card)
	}
	return
}

func (calendar *Calendar) SetItems(items []Item) {
	calendar.Cards = []*CalendarCard{}
	for _, item := range items {
		if card, ok := item.(*CalendarCard); ok {
			calendar.Cards = append(calendar.Cards, card)
		}
	}
}

func (calendar *Calendar) GetType() LayoutType {
	return LayoutTypeCalendar
}

func (calendar *Calendar) CountItems() int {
	return len(calendar.Cards)
}

func (calendar *Calendar) GetFields() []Field {
	ret := []Field{}
	for _, field := range calendar.Fields {
		ret = append(ret, field)
	}
	return ret
}

func (calendar *Calendar) GetField(id string) (ret Field, fieldIndex int) {
	for i, field := range calendar.Fields {
		if field.ID == id {
			ret = field
			fieldIndex = i
			return
		}
	}
	return nil, -1
}

func (calendar *Calendar) GetValue(itemID, keyID string) (ret *Value) {
	for _, card := range calendar.Cards {
		if card.ID == itemID {
			ret = card.GetValue(keyID)
			return
		}
	}
	return
}

func (calendar *Calendar) GetSorts() []*ViewSort {
	if nil == calendar.BaseInstance {
		return []*ViewSort{}
	}
	return calendar.BaseInstance.Sorts
}

func (calendar *Calendar) GetFilters() []*ViewFilter {
	if nil == calendar.BaseInstance {
		return []*ViewFilter{}
	}
	return calendar.BaseInstance.Filters
}
