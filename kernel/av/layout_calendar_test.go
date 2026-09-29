package av

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestCalendarTemplateDates(t *testing.T) {
	oldLang, oldLangs := util.Lang, util.AttrViewLangs
	util.AttrViewLangs = map[string]map[string]any{}
	t.Cleanup(func() { util.Lang, util.AttrViewLangs = oldLang, oldLangs })
	data, err := os.ReadFile("testdata/calendar_template_dates.json")
	if err != nil {
		t.Fatal(err)
	}
	var cases []struct{ Name, Zone, Content, Start, End, Lang, Format string }
	if err = json.Unmarshal(data, &cases); err != nil {
		t.Fatal(err)
	}
	for _, test := range cases {
		t.Run(test.Name, func(t *testing.T) {
			lang := test.Lang
			if lang == "" {
				lang = "en"
			}
			loadCalendarTestLanguage(t, lang)
			location, err := time.LoadLocation(test.Zone)
			if err != nil {
				t.Fatal(err)
			}
			value := &Value{Type: KeyTypeDate, HasRenderTemplate: true, RenderedContent: test.Content,
				Date: &ValueDate{Content: 1, IsNotEmpty: true, Content2: 9999999999999, HasEndDate: true, IsNotEmpty2: true}}
			before, _ := json.Marshal(value)
			date := newCalendarTemplateDateParser(DateDisplayFormat(test.Format))(value.RenderedContent, location)
			start, end, ok := CalendarInterval(&Value{Type: KeyTypeDate, Date: date}, location)
			if ok != (test.Start != "") {
				t.Fatalf("unexpected availability: %v", ok)
			}
			if ok {
				wantStart, _ := time.Parse(time.RFC3339, test.Start)
				wantEnd, _ := time.Parse(time.RFC3339, test.End)
				if start != wantStart.UnixMilli() || end != wantEnd.UnixMilli() {
					t.Fatalf("unexpected interval %d - %d", start, end)
				}
			}
			after, _ := json.Marshal(value)
			if string(before) != string(after) {
				t.Fatal("calendar changed the stored date")
			}
		})
	}
}

func loadCalendarTestLanguage(t *testing.T, lang string) {
	t.Helper()
	data, err := os.ReadFile(filepath.Join("../../app/appearance/langs", lang+".json"))
	if err != nil {
		t.Fatal(err)
	}
	var language struct {
		AttrView map[string]any `json:"_attrView"`
	}
	if err = json.Unmarshal(data, &language); err != nil {
		t.Fatal(err)
	}
	util.Lang = lang
	util.AttrViewLangs[lang] = language.AttrView
}

func TestCalendarTemplateAllLanguages(t *testing.T) {
	oldLang, oldLangs := util.Lang, util.AttrViewLangs
	util.AttrViewLangs = map[string]map[string]any{}
	t.Cleanup(func() { util.Lang, util.AttrViewLangs = oldLang, oldLangs })
	paths, err := filepath.Glob("../../app/appearance/langs/*.json")
	if err != nil || len(paths) == 0 {
		t.Fatalf("language files: %v", err)
	}
	for _, path := range paths {
		lang := strings.TrimSuffix(filepath.Base(path), ".json")
		loadCalendarTestLanguage(t, lang)
		parse := newCalendarTemplateDateParser(DateDisplayFormatFull)
		for month, name := range strings.Split(GetAttributeViewI18n("dateMonths"), "|") {
			content := strings.NewReplacer("${year}", "2026", "${month}", name, "${day}", "2").Replace(GetAttributeViewI18n("dateFormatFullTemplate"))
			for _, suffix := range []string{"", " 09:30:15"} {
				date := parse(content+suffix, time.UTC)
				want := time.Date(2026, time.Month(month+1), 2, 0, 0, 0, 0, time.UTC)
				if suffix != "" {
					want = want.Add(9*time.Hour + 30*time.Minute + 15*time.Second)
				}
				if date == nil || date.Content != want.UnixMilli() || date.IsNotTime != (suffix == "") {
					t.Fatalf("%s: %s%s produced %+v", lang, content, suffix, date)
				}
			}
		}
	}
}

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
	if len(calendar.UndatedRows) != 1 || calendar.UndatedRows[0].ID != "noDate" {
		t.Fatalf("undated rows must remain available independently of the visible range: %+v", calendar.UndatedRows)
	}
	calendar.Calendar.DateKeyID = "deleted"
	if err := FilterCalendarRows(calendar, range_, ""); nil != err || len(calendar.Rows) != 0 || len(calendar.UndatedRows) != 0 {
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
