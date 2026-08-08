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
	"slices"
	"testing"
	"time"
)

type dateSortTestValue struct {
	start       int64
	end         int64
	hasEndDate  bool
	isNotTime   bool
	endNotEmpty bool
}

func TestDateEndpointSort(t *testing.T) {
	values := map[string]dateSortTestValue{
		"a": {start: 100, end: 400, hasEndDate: true, endNotEmpty: true},
		"b": {start: 200, end: 300, hasEndDate: true, endNotEmpty: true},
	}
	tests := []struct {
		name         string
		dateEndpoint DateEndpoint
		want         []string
	}{
		{name: "default start endpoint", want: []string{"a", "b"}},
		{name: "explicit start endpoint", dateEndpoint: DateEndpointStart, want: []string{"a", "b"}},
		{name: "end endpoint", dateEndpoint: DateEndpointEnd, want: []string{"b", "a"}},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			table := newDateSortTestTable(values, SortOrderAsc, test.dateEndpoint)
			Sort(table, &AttributeView{})
			assertDateSortRowIDs(t, table, test.want)
		})
	}
}

func TestDateEndpointSortFallbackAndEmpty(t *testing.T) {
	t.Run("fallback to start endpoint", func(t *testing.T) {
		table := newDateSortTestTable(map[string]dateSortTestValue{
			"a": {start: 100},
			"b": {start: 200, end: 50, hasEndDate: true, endNotEmpty: true},
		}, SortOrderAsc, DateEndpointEnd)
		Sort(table, &AttributeView{})
		assertDateSortRowIDs(t, table, []string{"b", "a"})
	})

	for _, order := range []SortOrder{SortOrderAsc, SortOrderDesc} {
		t.Run("empty end endpoint "+string(order), func(t *testing.T) {
			table := newDateSortTestTable(map[string]dateSortTestValue{
				"a": {start: 100, hasEndDate: true},
				"b": {start: 200, end: 50, hasEndDate: true, endNotEmpty: true},
			}, order, DateEndpointEnd)
			Sort(table, &AttributeView{})
			assertDateSortRowIDs(t, table, []string{"b", "a"})
		})
	}
}

func TestDateEndpointSortWithoutTime(t *testing.T) {
	start := time.Date(2026, 7, 27, 0, 0, 0, 0, time.Local).UnixMilli()
	table := newDateSortTestTable(map[string]dateSortTestValue{
		"a": {
			start:       start,
			end:         time.Date(2026, 7, 28, 23, 0, 0, 0, time.Local).UnixMilli(),
			hasEndDate:  true,
			isNotTime:   true,
			endNotEmpty: true,
		},
		"b": {
			start:       start,
			end:         time.Date(2026, 7, 28, 1, 0, 0, 0, time.Local).UnixMilli(),
			hasEndDate:  true,
			isNotTime:   true,
			endNotEmpty: true,
		},
	}, SortOrderAsc, DateEndpointEnd)

	Sort(table, &AttributeView{})
	assertDateSortRowIDs(t, table, []string{"a", "b"})
}

func newDateSortTestTable(values map[string]dateSortTestValue, order SortOrder, dateEndpoint DateEndpoint) *Table {
	const (
		blockColumnID = "block"
		dateColumnID  = "date"
	)
	rows := make([]*TableRow, 0, len(values))
	for _, id := range []string{"a", "b"} {
		value := values[id]
		createdAt := int64(1)
		if "b" == id {
			createdAt = 2
		}
		rows = append(rows, &TableRow{
			ID: id,
			Cells: []*TableCell{
				{
					BaseValue: &BaseValue{
						ValueType: KeyTypeBlock,
						Value: &Value{
							Type:      KeyTypeBlock,
							CreatedAt: createdAt,
							Block:     &ValueBlock{Content: id},
						},
					},
				},
				{
					BaseValue: &BaseValue{
						ValueType: KeyTypeDate,
						Value: &Value{
							Type:      KeyTypeDate,
							CreatedAt: 1709740800000,
							Date: &ValueDate{
								Content:     value.start,
								IsNotEmpty:  true,
								Content2:    value.end,
								IsNotEmpty2: value.endNotEmpty,
								HasEndDate:  value.hasEndDate,
								IsNotTime:   value.isNotTime,
							},
						},
					},
				},
			},
		})
	}

	return &Table{
		BaseInstance: &BaseInstance{
			ID: "table",
			Sorts: []*ViewSort{{
				Column:       dateColumnID,
				Order:        order,
				DateEndpoint: dateEndpoint,
			}},
		},
		Columns: []*TableColumn{
			{BaseInstanceField: &BaseInstanceField{ID: blockColumnID, Type: KeyTypeBlock}},
			{BaseInstanceField: &BaseInstanceField{ID: dateColumnID, Type: KeyTypeDate}},
		},
		Rows: rows,
	}
}

func assertDateSortRowIDs(t *testing.T, table *Table, want []string) {
	t.Helper()
	got := make([]string, 0, len(table.Rows))
	for _, row := range table.Rows {
		got = append(got, row.ID)
	}
	if !slices.Equal(got, want) {
		t.Fatalf("unexpected row order: got %v, want %v", got, want)
	}
}
