// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package dav

import (
	"crypto/sha256"
	"encoding/binary"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/emersion/go-ical"
	"github.com/teambition/rrule-go"
)

// VTimeZoneLocation 返回 VTIMEZONE 定义的时区，无法解析时返回 nil。TZID 或 Lightning 等客户端写的 X-LIC-LOCATION 是
// IANA 名称时使用 IANA 时区：客户端写出的定义常常只含当前规则（例如 Thunderbird 的美国时区从 2007 年开始），IANA 时区
// 还含有更早的规则，客户端自己也按它计算。其余时区（Outlook 的 Windows 时区名、自定义名称）按 STANDARD/DAYLIGHT 子组件
// 给出的偏移和规则构造（RFC 5545 §3.6.5）。
func VTimeZoneLocation(zone *ical.Component) *time.Location {
	tzid, _ := zone.Props.Text(ical.PropTimezoneID)
	if loc := ResolveTimeZone(tzid); nil != loc {
		return loc
	}
	if location, _ := zone.Props.Text("X-LIC-LOCATION"); "" != location {
		if loc := ResolveTimeZone(location); nil != loc {
			return loc
		}
	}

	var text strings.Builder
	encodeComponent(&text, zone)
	key := sha256.Sum256([]byte(text.String()))
	vtimezoneLocations.Lock()
	defer vtimezoneLocations.Unlock()
	if loc, ok := vtimezoneLocations.cache[key]; ok {
		return loc
	}
	loc, _ := observanceLocation(tzid, zone)
	if maxCachedVTimeZones <= len(vtimezoneLocations.cache) {
		clear(vtimezoneLocations.cache)
	}
	vtimezoneLocations.cache[key] = loc
	return loc
}

// maxCachedVTimeZones 限制缓存的自定义时区数量；日历对象由客户端写入，不同的定义不能无限占用内存。
const maxCachedVTimeZones = 256

var vtimezoneLocations = struct {
	sync.Mutex
	cache map[[sha256.Size]byte]*time.Location
}{cache: map[[sha256.Size]byte]*time.Location{}}

// timeZoneHorizon 之后不再展开时区规则，此后沿用最后一次切换后的偏移。
var timeZoneHorizon = time.Date(2200, 1, 1, 0, 0, 0, 0, time.UTC)

// maxTimeZoneOnsets 限制单个 STANDARD/DAYLIGHT 子组件展开的切换次数。
const maxTimeZoneOnsets = 10000

type tzType struct {
	offset int
	isDST  bool
}

// tzTransition 是一次切换：at 是 Unix 秒，from 是切换前的偏移，typ 是切换后的偏移。
type tzTransition struct {
	at   int64
	from int
	typ  tzType
}

// observanceLocation 按 STANDARD/DAYLIGHT 子组件构造时区。每个子组件的 DTSTART、RRULE、RDATE 是按切换前的偏移
// TZOFFSETFROM 表示的本地时间，此后偏移为 TZOFFSETTO；最早一次切换之前使用它的 TZOFFSETFROM。
func observanceLocation(tzid string, zone *ical.Component) (*time.Location, error) {
	var transitions []tzTransition
	for _, observance := range zone.Children {
		if ical.CompTimezoneStandard != observance.Name && ical.CompTimezoneDaylight != observance.Name {
			continue
		}
		from, to, onsets, err := observanceOnsets(observance)
		if err != nil {
			return nil, err
		}
		for _, onset := range onsets {
			transitions = append(transitions, tzTransition{at: onset.Unix() - int64(from), from: from,
				typ: tzType{offset: to, isDST: ical.CompTimezoneDaylight == observance.Name}})
		}
	}
	if 0 == len(transitions) {
		return nil, errors.New("VTIMEZONE has no observance")
	}
	sort.SliceStable(transitions, func(i, j int) bool { return transitions[i].at < transitions[j].at })

	data, err := tzifData(tzType{offset: transitions[0].from}, transitions)
	if err != nil {
		return nil, err
	}
	return time.LoadLocationFromTZData(tzid, data)
}

// observanceOnsets 返回子组件的偏移和全部切换时刻的本地时间（以 UTC 时区的 time.Time 表示本地时钟读数）。
func observanceOnsets(observance *ical.Component) (from, to int, onsets []time.Time, err error) {
	if from, err = observanceOffset(observance, ical.PropTimezoneOffsetFrom); err != nil {
		return
	}
	if to, err = observanceOffset(observance, ical.PropTimezoneOffsetTo); err != nil {
		return
	}
	// RFC 5545 要求本地时间；带 Z 的 UTC 时间换算为切换前的本地时间
	local := func(value string) (time.Time, error) {
		value = strings.TrimSpace(value)
		if strings.HasSuffix(value, "Z") {
			t, parseErr := time.ParseInLocation(icalDateTimeUTCFormat, value, time.UTC)
			return t.Add(time.Duration(from) * time.Second), parseErr
		}
		return time.ParseInLocation(icalDateTimeFormat, value, time.UTC)
	}
	prop := observance.Props.Get(ical.PropDateTimeStart)
	if nil == prop {
		return 0, 0, nil, errors.New("observance requires DTSTART")
	}
	start, err := local(prop.Value)
	if err != nil {
		return
	}
	onsets = append(onsets, start)
	if prop = observance.Props.Get(ical.PropRecurrenceRule); nil != prop {
		option, optionErr := rrule.StrToROptionInLocation(prop.Value, time.UTC)
		if optionErr != nil {
			return 0, 0, nil, optionErr
		}
		option.Dtstart = start
		// VTIMEZONE 中的 UNTIL 必须是 UTC 时间（RFC 5545 §3.3.10），换算到本地时钟后再与切换时刻比较
		for _, part := range strings.Split(prop.Value, ";") {
			if name, value, ok := strings.Cut(part, "="); ok && strings.EqualFold("UNTIL", name) && strings.HasSuffix(value, "Z") {
				option.Until = option.Until.Add(time.Duration(from) * time.Second)
			}
		}
		// rrule-go 用 time.Duration 计算与 DTSTART 的间隔，约 292 年后静默结束，而 Outlook 的规则从 1601 年开始；
		// 没有 COUNT 时每次只展开一百年，再从最后一次切换起继续
		windowStart, until := start, option.Until
		for {
			window := *option
			window.Dtstart = windowStart
			if 0 == option.Count {
				window.Until = windowStart.AddDate(100, 0, 0)
				if !until.IsZero() && until.Before(window.Until) {
					window.Until = until
				}
			}
			rule, ruleErr := rrule.NewRRule(window)
			if ruleErr != nil {
				return 0, 0, nil, ruleErr
			}
			last := windowStart
			next := rule.Iterator()
			for onset, ok := next(); ok && !onset.After(timeZoneHorizon) && len(onsets) < maxTimeZoneOnsets; onset, ok = next() {
				if onset.After(last) {
					onsets = append(onsets, onset)
					last = onset
				}
			}
			if 0 != option.Count || !last.After(windowStart) || !window.Until.Before(timeZoneHorizon) ||
				(!until.IsZero() && !window.Until.Before(until)) || maxTimeZoneOnsets <= len(onsets) {
				break
			}
			windowStart = last
		}
	}
	for _, rdate := range observance.Props[ical.PropRecurrenceDates] {
		for _, value := range strings.Split(rdate.Value, ",") {
			onset, parseErr := local(value)
			if parseErr != nil {
				return 0, 0, nil, parseErr
			}
			onsets = append(onsets, onset)
		}
	}
	return
}

// observanceOffset 解析 UTC-OFFSET 值：±HHMM 或 ±HHMMSS（RFC 5545 §3.3.14）。
func observanceOffset(observance *ical.Component, name string) (int, error) {
	prop := observance.Props.Get(name)
	if nil == prop {
		return 0, errors.New("observance requires " + name)
	}
	value := strings.TrimSpace(prop.Value)
	if (5 != len(value) && 7 != len(value)) || ('+' != value[0] && '-' != value[0]) {
		return 0, errors.New("invalid UTC offset " + value)
	}
	var parts [3]int
	for i := 0; 1+2*i < len(value); i++ {
		part, err := strconv.Atoi(value[1+2*i : 3+2*i])
		if err != nil || (0 < i && 59 < part) {
			return 0, errors.New("invalid UTC offset " + value)
		}
		parts[i] = part
	}
	offset := parts[0]*3600 + parts[1]*60 + parts[2]
	if '-' == value[0] {
		offset = -offset
	}
	return offset, nil
}

// tzifData 把时区切换编码为 TZif 第 2 版数据（RFC 8536），供 time.LoadLocationFromTZData 使用。第 0 个类型是第一次
// 切换之前的偏移，切换都不引用它，time 包据此在第一次切换之前使用它。
func tzifData(initial tzType, transitions []tzTransition) ([]byte, error) {
	types := []tzType{initial}
	index := map[tzType]int{}
	var times []int64
	var indexes []byte
	previous := initial
	for i, transition := range transitions {
		if (0 < i && transition.at == transitions[i-1].at) || transition.typ == previous {
			continue
		}
		typeIndex, ok := index[transition.typ]
		if !ok {
			typeIndex = len(types)
			index[transition.typ] = typeIndex
			types = append(types, transition.typ)
		}
		if 255 < typeIndex {
			return nil, errors.New("too many time zone offsets")
		}
		times = append(times, transition.at)
		indexes = append(indexes, byte(typeIndex))
		previous = transition.typ
	}

	var chars []byte
	designations := map[string]int{}
	var desigIndexes []int
	for _, typ := range types {
		name := formatUTCOffset(typ.offset)
		at, ok := designations[name]
		if !ok {
			at = len(chars)
			designations[name] = at
			chars = append(append(chars, name...), 0)
		}
		desigIndexes = append(desigIndexes, at)
	}
	if 255 < len(chars) {
		return nil, errors.New("too many time zone offsets")
	}

	var data []byte
	block := func(times []int64, timeSize int) {
		data = append(data, "TZif2"...)
		data = append(data, make([]byte, 15)...)
		for _, count := range []int{0, 0, 0, len(times), len(types), len(chars)} {
			data = binary.BigEndian.AppendUint32(data, uint32(count))
		}
		for _, at := range times {
			if 8 == timeSize {
				data = binary.BigEndian.AppendUint64(data, uint64(at))
			} else {
				data = binary.BigEndian.AppendUint32(data, uint32(int32(at)))
			}
		}
		data = append(data, indexes[:len(times)]...)
		for i, typ := range types {
			data = binary.BigEndian.AppendUint32(data, uint32(int32(typ.offset)))
			isDST := byte(0)
			if typ.isDST {
				isDST = 1
			}
			data = append(data, isDST, byte(desigIndexes[i]))
		}
		data = append(data, chars...)
	}
	// 第 1 版数据块只能表示 32 位时间，这里不含切换，读取方使用其后的 64 位数据块
	block(nil, 4)
	block(times, 8)
	return append(data, '\n', '\n'), nil
}

func formatUTCOffset(offset int) string {
	sign := '+'
	if offset < 0 {
		sign, offset = '-', -offset
	}
	name := fmt.Sprintf("%c%02d%02d", sign, offset/3600, offset/60%60)
	if seconds := offset % 60; 0 != seconds {
		name += fmt.Sprintf("%02d", seconds)
	}
	return name
}
