// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package av

import (
	"testing"
	"time"

	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestDateDisplayFormat(t *testing.T) {
	oldLang := util.Lang
	oldAttrViewLangs := util.AttrViewLangs
	util.Lang = "en_US"
	util.AttrViewLangs = map[string]map[string]any{
		"en_US": {
			"dateMonths":             "January|February|March|April|May|June|July|August|September|October|November|December",
			"dateFormatFullTemplate": "${month} ${day}, ${year}",
		},
	}
	t.Cleanup(func() {
		util.Lang = oldLang
		util.AttrViewLangs = oldAttrViewLangs
	})

	start := time.Date(2024, time.March, 5, 14, 7, 0, 0, time.Local).UnixMilli()
	end := time.Date(2024, time.April, 6, 14, 7, 0, 0, time.Local).UnixMilli()
	tests := []struct {
		format   DateDisplayFormat
		expected string
	}{
		{DateDisplayFormatDefault, "2024-03-05"},
		{DateDisplayFormatFull, "March 5, 2024"},
		{DateDisplayFormatMonthDayYear, "03/05/2024"},
		{DateDisplayFormatDayMonthYear, "05/03/2024"},
		{DateDisplayFormatYearMonthDay, "2024/03/05"},
	}
	for _, test := range tests {
		date := NewFormattedValueDate(start, 0, DateFormatNone, true, false)
		date.FormatDate(test.format)
		if test.expected != date.FormattedContent {
			t.Fatalf("format %q: expected %q, got %q", test.format, test.expected, date.FormattedContent)
		}
	}

	date := NewFormattedValueDate(start, end, DateFormatNone, false, true)
	date.FormatDate(DateDisplayFormatDayMonthYear)
	if "05/03/2024 14:07 → 06/04/2024 14:07" != date.FormattedContent {
		t.Fatalf("unexpected range: %q", date.FormattedContent)
	}
	value := &Value{Type: KeyTypeDate, Date: date}
	if date.FormattedContent != value.String(true) {
		t.Fatalf("formatted string not used: %q", value.String(true))
	}
	if DateDisplayFormat("invalid").IsValid() {
		t.Fatal("invalid date display format accepted")
	}
}

func TestCreatedAndUpdatedDateDisplayFormat(t *testing.T) {
	content := time.Date(2024, time.March, 5, 14, 7, 0, 0, time.Local).UnixMilli()
	created := NewFormattedValueCreated(content, 0, CreatedFormatNone, false)
	created.FormatDate(DateDisplayFormatMonthDayYear, false)
	if "03/05/2024 14:07" != created.FormattedContent {
		t.Fatalf("unexpected created date: %q", created.FormattedContent)
	}

	updated := NewFormattedValueUpdated(content, 0, UpdatedFormatNone, true)
	updated.FormatDate(DateDisplayFormatYearMonthDay, true)
	if "2024/03/05" != updated.FormattedContent {
		t.Fatalf("unexpected updated date: %q", updated.FormattedContent)
	}
}
