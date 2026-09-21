package av

import (
	"encoding/json"
	"reflect"
	"testing"
	"time"
)

func TestCalendarRowLimitCompatibility(t *testing.T) {
	var settings CalendarSettings
	if err := json.Unmarshal([]byte(`{"dateKeyID":"date","colorKeyID":"","weekStart":1}`), &settings); err != nil {
		t.Fatal(err)
	}
	if settings.RowLimit != 0 || !settings.ValidRowLimit() {
		t.Fatal("existing calendar settings must retain the default row limit")
	}
	for _, limit := range []int{0, 3, 5, 10, -1} {
		settings.RowLimit = limit
		data, err := json.Marshal(settings)
		var actual CalendarSettings
		if err != nil || json.Unmarshal(data, &actual) != nil || actual != settings || !actual.ValidRowLimit() {
			t.Fatalf("row limit round trip: %d", limit)
		}
	}
	for _, limit := range []int{-2, 1, 4, 100} {
		settings.RowLimit = limit
		if settings.ValidRowLimit() {
			t.Fatalf("invalid row limit accepted: %d", limit)
		}
	}
}

func TestCalendarInterval(t *testing.T) {
	location, err := time.LoadLocation("America/New_York")
	if nil != err {
		t.Fatal(err)
	}
	start := time.Date(2026, 3, 8, 0, 0, 0, 0, location).UnixMilli()
	next := time.Date(2026, 3, 9, 0, 0, 0, 0, location).UnixMilli()
	for _, test := range []struct {
		name       string
		date       ValueDate
		start, end int64
		ok         bool
	}{
		{"empty", ValueDate{}, 0, 0, false},
		{"all day across DST", ValueDate{Content: start, IsNotEmpty: true, IsNotTime: true}, start, next, true},
		{"midnight end", ValueDate{Content: start, IsNotEmpty: true, Content2: next, HasEndDate: true, IsNotEmpty2: true}, start, next, true},
		{"inclusive end", ValueDate{Content: start, IsNotEmpty: true, Content2: next, HasEndDate: true, IsNotEmpty2: true, IsNotTime: true}, start, next + 86400000, true},
		{"end only", ValueDate{Content2: next, HasEndDate: true, IsNotEmpty2: true}, next, next, true},
		{"reversed", ValueDate{Content: next, IsNotEmpty: true, Content2: start, HasEndDate: true, IsNotEmpty2: true}, next, next, true},
		{"epoch", ValueDate{Content: 0, IsNotEmpty: true}, 0, 0, true},
	} {
		t.Run(test.name, func(t *testing.T) {
			before := test.date
			gotStart, gotEnd, ok := CalendarInterval(&Value{Type: KeyTypeDate, Date: &test.date}, location)
			if gotStart != test.start || gotEnd != test.end || ok != test.ok || test.date != before {
				t.Fatalf("interval %d - %d (%v), source %+v", gotStart, gotEnd, ok, test.date)
			}
		})
	}
	if next-start != 23*3600000 {
		t.Fatal("fixture must cross the DST transition")
	}
}

func TestCalendarRangeIntersection(t *testing.T) {
	row := func(id string, start, end int64) *TableRow {
		return &TableRow{ID: id, Cells: []*TableCell{{BaseValue: &BaseValue{Value: &Value{KeyID: "date", Type: KeyTypeDate,
			Date: &ValueDate{Content: start, Content2: end, HasEndDate: true, IsNotEmpty: true, IsNotEmpty2: true}}}}}}
	}
	calendar := &Calendar{Table: &Table{Calendar: &CalendarSettings{DateKeyID: "date"},
		Columns: []*TableColumn{{BaseInstanceField: &BaseInstanceField{ID: "date", Type: KeyTypeDate}}},
		Rows: []*TableRow{row("endsAtStart", 0, 100), row("spans", 0, 300), row("pointAtStart", 100, 100),
			row("pointAtEnd", 200, 200), row("futureTarget", 1000, 1000), {ID: "noDate"}},
	}}
	range_ := &CalendarRange{Start: 100, End: 200, TimeZone: "UTC"}
	if err := FilterCalendarRows(calendar, range_, "futureTarget"); nil != err {
		t.Fatal(err)
	}
	var ids []string
	for _, row := range calendar.Rows {
		ids = append(ids, row.ID)
	}
	if !reflect.DeepEqual(ids, []string{"spans", "pointAtStart", "futureTarget"}) || calendar.CalendarTargetDate == nil || *calendar.CalendarTargetDate != 1000 {
		t.Fatalf("unexpected rows or target date: %+v", calendar)
	}
	calendar.Calendar.DateKeyID = "deleted"
	if err := FilterCalendarRows(calendar, range_, ""); nil != err || len(calendar.Rows) != 0 {
		t.Fatalf("missing binding must produce an empty calendar: %v", err)
	}
	for _, invalid := range []*CalendarRange{{}, {Start: 2, End: 1, TimeZone: "UTC"},
		{Start: 0, End: 64 * 86400000, TimeZone: "UTC"}, {Start: 1, End: 2, TimeZone: "invalid"}} {
		if _, err := invalid.Location(); nil == err {
			t.Fatalf("accepted invalid range: %+v", invalid)
		}
	}
	for _, year := range []int{0, 9999} {
		start := time.Date(year, 12, 1, 0, 0, 0, 0, time.UTC)
		if _, err := (&CalendarRange{Start: start.UnixMilli(), End: start.AddDate(0, 0, 42).UnixMilli(), TimeZone: "UTC"}).Location(); err != nil {
			t.Fatalf("calendar grid cannot cross the supported year boundary: %v", err)
		}
	}
}
