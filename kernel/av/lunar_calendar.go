// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

package av

import (
	_ "embed"
	"encoding/json"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

// 前后端读取同一份离线对照表，避免设备历法库版本不同导致日期漂移。
//
//go:embed lunar_calendar_data.json
var lunarCalendarJSON []byte

var lunarCalendar = func() (data struct {
	FirstYear int      `json:"firstYear"`
	LastYear  int      `json:"lastYear"`
	Months    [][4]int `json:"months"`
}) {
	if err := json.Unmarshal(lunarCalendarJSON, &data); err != nil {
		panic(err)
	}
	return
}()

type lunarDate struct {
	year, month, day int
}

func solarToLunar(solar time.Time) (lunar lunarDate, ok bool) {
	day := int(time.Date(solar.Year(), solar.Month(), solar.Day(), 0, 0, 0, 0, time.UTC).Unix() / 86400)
	index := sort.Search(len(lunarCalendar.Months), func(i int) bool { return lunarCalendar.Months[i][2] > day }) - 1
	if index < 0 {
		return
	}
	month := lunarCalendar.Months[index]
	if day >= month[2]+month[3] {
		return
	}
	return lunarDate{month[0], month[1], day - month[2] + 1}, true
}

// 只转换公历年月日，时区和具体时间由调用方校验，避免经过不存在的本地零点时改变日期。
func lunarToSolar(lunar lunarDate) (time.Time, bool) {
	for _, month := range lunarCalendar.Months {
		if month[0] == lunar.year && month[1] == lunar.month && lunar.day > 0 && lunar.day <= month[3] {
			return time.Unix(int64(month[2]+lunar.day-1)*86400, 0).UTC(), true
		}
	}
	return time.Time{}, false
}

func lunarMonthLabel(month int) string {
	index := month
	if index < 0 {
		index = -index
	}
	label := strings.Split(GetAttributeViewI18n("lunarMonths"), "|")[index-1]
	if month < 0 {
		label = strings.ReplaceAll(GetAttributeViewI18n("lunarLeapMonth"), "${month}", label)
	}
	return label
}

func formatLunarDate(lunar lunarDate) string {
	return strings.NewReplacer("${year}", strconv.Itoa(lunar.year), "${month}", lunarMonthLabel(lunar.month),
		"${day}", strings.Split(GetAttributeViewI18n("lunarDays"), "|")[lunar.day-1]).Replace(GetAttributeViewI18n("lunarDateTemplate"))
}

func newLunarDateParser() func(string) (time.Time, bool) {
	names := make([]string, 0, 24)
	monthValues := map[string]int{}
	for month := 1; month <= 12; month++ {
		for _, value := range []int{month, -month} {
			name := lunarMonthLabel(value)
			names = append(names, regexp.QuoteMeta(name))
			monthValues[name] = value
		}
	}
	days := strings.Split(GetAttributeViewI18n("lunarDays"), "|")
	dayNames := make([]string, len(days))
	dayValues := map[string]int{}
	for i, day := range days {
		dayNames[i] = regexp.QuoteMeta(day)
		dayValues[day] = i + 1
	}
	pattern := regexp.QuoteMeta(GetAttributeViewI18n("lunarDateTemplate"))
	pattern = strings.NewReplacer(regexp.QuoteMeta("${year}"), `(?P<year>\d{4})`,
		regexp.QuoteMeta("${month}"), "(?P<month>"+strings.Join(names, "|")+")",
		regexp.QuoteMeta("${day}"), "(?P<day>"+strings.Join(dayNames, "|")+")").Replace(pattern)
	parser := regexp.MustCompile("^" + pattern + "$")
	return func(content string) (time.Time, bool) {
		parts := parser.FindStringSubmatch(content)
		if parts == nil {
			return time.Time{}, false
		}
		year, _ := strconv.Atoi(parts[parser.SubexpIndex("year")])
		return lunarToSolar(lunarDate{year, monthValues[parts[parser.SubexpIndex("month")]], dayValues[parts[parser.SubexpIndex("day")]]})
	}
}
