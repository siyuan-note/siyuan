package av

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/siyuan-note/siyuan/kernel/util"
)

func setLunarTestLanguage(t *testing.T, language string) {
	t.Helper()
	beforeLang, beforeTerms := util.Lang, util.AttrViewLangs
	data, err := os.ReadFile(filepath.Join("../../app/appearance/langs", language+".json"))
	if err != nil {
		t.Fatal(err)
	}
	var terms struct {
		AV map[string]any `json:"_attrView"`
	}
	if err = json.Unmarshal(data, &terms); err != nil {
		t.Fatal(err)
	}
	util.Lang, util.AttrViewLangs = language, map[string]map[string]any{language: terms.AV}
	t.Cleanup(func() { util.Lang, util.AttrViewLangs = beforeLang, beforeTerms })
}

func TestLunarCalendarCoverage(t *testing.T) {
	for index, month := range lunarCalendar.Months {
		if month[0] < 1901 || month[0] > 2100 || month[1] == 0 || month[1] < -12 || month[1] > 12 {
			t.Fatalf("invalid month: %v", month)
		}
		if index+1 < len(lunarCalendar.Months) {
			if month[3] != 29 && month[3] != 30 || month[2]+month[3] != lunarCalendar.Months[index+1][2] {
				t.Fatalf("month continuity: %v", month)
			}
		}
		for day := 1; day <= month[3]; day++ {
			want := lunarDate{month[0], month[1], day}
			solar, ok := lunarToSolar(want)
			if !ok {
				t.Fatalf("cannot convert %v", want)
			}
			if got, ok := solarToLunar(solar); !ok || got != want {
				t.Fatalf("round trip %v: %v", want, got)
			}
		}
	}
	for _, date := range []time.Time{time.Date(1901, 2, 18, 0, 0, 0, 0, time.UTC), time.Date(2101, 1, 1, 0, 0, 0, 0, time.UTC)} {
		if _, ok := solarToLunar(date); ok {
			t.Fatalf("out-of-range date accepted: %v", date)
		}
	}
	for _, date := range []lunarDate{{2026, -6, 1}, {2025, -6, 30}, {2025, 1, 31}, {2100, 12, 2}, {1900, 1, 1}} {
		if _, ok := lunarToSolar(date); ok {
			t.Fatalf("invalid lunar date accepted: %v", date)
		}
	}
}

func TestLunarCalendarKnownDates(t *testing.T) {
	for _, test := range []struct {
		solar string
		lunar lunarDate
	}{
		{"1901-02-19", lunarDate{1901, 1, 1}},
		{"1986-05-29", lunarDate{1986, 4, 21}},
		{"2025-07-25", lunarDate{2025, -6, 1}},
		{"2026-09-25", lunarDate{2026, 8, 15}},
		{"2033-12-22", lunarDate{2033, -11, 1}},
		{"2100-12-31", lunarDate{2100, 12, 1}},
	} {
		for _, offset := range []int{-7 * 3600, 8 * 3600} {
			location := time.FixedZone("test", offset)
			solar, err := time.ParseInLocation("2006-01-02", test.solar, location)
			if err != nil {
				t.Fatal(err)
			}
			if got, ok := solarToLunar(solar); !ok || got != test.lunar {
				t.Fatalf("%s: got %v, want %v", test.solar, got, test.lunar)
			}
		}
	}
}

func TestLunarDateLocalizedRoundTrips(t *testing.T) {
	files, err := filepath.Glob("../../app/appearance/langs/*.json")
	if err != nil {
		t.Fatal(err)
	}
	for _, path := range files {
		language := filepath.Base(path)
		language = language[:len(language)-5]
		t.Run(language, func(t *testing.T) {
			setLunarTestLanguage(t, language)
			parser := newCalendarTemplateDateParser(DateDisplayFormatLunar)
			for _, lunar := range []lunarDate{{2025, 6, 1}, {2025, -6, 1}, {2026, 8, 15}} {
				date, ok := lunarToSolar(lunar)
				if !ok {
					t.Fatal(lunar)
				}
				date = time.Date(date.Year(), date.Month(), date.Day(), 14, 7, 0, 0, time.Local)
				text := formatDateDisplay(date.UnixMilli(), DateDisplayFormatLunar, false)
				got := parser(text, time.Local)
				if got == nil || got.Content != date.UnixMilli() {
					t.Fatalf("localized round trip: %q, %+v", text, got)
				}
			}
			original := time.Date(1800, 1, 2, 14, 7, 0, 0, time.Local)
			text := formatDateDisplay(original.UnixMilli(), DateDisplayFormatLunar, false)
			if parsed := parser(text, time.Local); parsed == nil || parsed.Content != original.UnixMilli() {
				t.Fatalf("legacy date lost outside lunar range: %q, %+v", text, parsed)
			}
		})
	}
}

func TestLunarTemplateDateDaylightSaving(t *testing.T) {
	setLunarTestLanguage(t, "en")
	for _, test := range []struct {
		zone                           string
		year                           int
		month                          time.Month
		day, hour, minute, invalidHour int
	}{
		{"America/Sao_Paulo", 2018, time.November, 4, 12, 30, 0},
		{"America/New_York", 2024, time.March, 10, 3, 30, 2},
	} {
		t.Run(test.zone, func(t *testing.T) {
			location, err := time.LoadLocation(test.zone)
			if err != nil {
				t.Fatal(err)
			}
			original := time.Date(test.year, test.month, test.day, test.hour, test.minute, 17, 0, location)
			lunar, ok := solarToLunar(original)
			if !ok {
				t.Fatal("date outside lunar range")
			}
			clock := original.Format("15:04:05")
			parser := newCalendarTemplateDateParser(DateDisplayFormatLunar)
			for _, dateText := range []string{formatLunarDate(lunar), original.Format("2006-01-02")} {
				parsed := parser(dateText+" "+clock, location)
				if parsed == nil || parsed.Content != original.UnixMilli() {
					t.Fatalf("valid time did not round trip: %q, %+v", dateText+" "+clock, parsed)
				}
				invalidClock := time.Date(2000, 1, 1, test.invalidHour, 30, 0, 0, time.UTC).Format("15:04")
				if parsed := parser(dateText+" "+invalidClock, location); parsed != nil {
					t.Fatalf("nonexistent local time accepted: %q, %+v", dateText+" "+invalidClock, parsed)
				}
			}
		})
	}
}
