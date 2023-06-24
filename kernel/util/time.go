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

package util

import (
	"bytes"
	"fmt"
	"math"
	"strings"
	"time"

	"github.com/dustin/go-humanize"
)

func Millisecond2Time(t int64) time.Time {
	sec := t / 1000
	msec := t % 1000
	return time.Unix(sec, msec*int64(time.Millisecond))
}

func CurrentTimeMillis() int64 {
	return time.Now().UnixMilli()
}

func CurrentTimeSecondsStr() string {
	return time.Now().Format("20060102150405")
}

func HumanizeDiffTime(a, b time.Time, lang string) string {
	labels := TimeLangs[lang]
	year, month, day, hour, min, _ := humanizeDiffTime(a, b)
	buf := bytes.Buffer{}
	if 0 < year {
		if 1 == year {
			buf.WriteString(fmt.Sprintf(labels["1y"].(string), " "))
		} else {
			buf.WriteString(fmt.Sprintf(labels["xy"].(string), year, " "))
		}
	}
	if 0 < month {
		if 1 == month {
			buf.WriteString(fmt.Sprintf(labels["1M"].(string), " "))
		} else {
			buf.WriteString(fmt.Sprintf(labels["xM"].(string), month, " "))
		}
	}
	if 0 < day {
		if 1 == day {
			buf.WriteString(fmt.Sprintf(labels["1d"].(string), " "))
		} else {
			buf.WriteString(fmt.Sprintf(labels["xd"].(string), day, " "))
		}
	}
	if 0 < hour {
		if 1 == hour {
			buf.WriteString(fmt.Sprintf(labels["1h"].(string), " "))
		} else {
			buf.WriteString(fmt.Sprintf(labels["xh"].(string), hour, " "))
		}
	}
	if 0 < min {
		if 1 == min {
			buf.WriteString(fmt.Sprintf(labels["1m"].(string), " "))
		} else {
			buf.WriteString(fmt.Sprintf(labels["xm"].(string), min, " "))
		}
	}
	return strings.TrimSpace(buf.String())
}

func humanizeDiffTime(a, b time.Time) (year, month, day, hour, min, sec int) {
	// 感谢 https://stackoverflow.com/a/36531443/1043233

	if a.Location() != b.Location() {
		b = b.In(a.Location())
	}
	if a.After(b) {
		a, b = b, a
	}
	y1, M1, d1 := a.Date()
	y2, M2, d2 := b.Date()

	h1, m1, s1 := a.Clock()
	h2, m2, s2 := b.Clock()

	year = y2 - y1
	month = int(M2 - M1)
	day = d2 - d1
	hour = h2 - h1
	min = m2 - m1
	sec = s2 - s1

	// Normalize negative values
	if sec < 0 {
		sec += 60
		min--
	}
	if min < 0 {
		min += 60
		hour--
	}
	if hour < 0 {
		hour += 24
		day--
	}
	if day < 0 {
		// days in month:
		t := time.Date(y1, M1, 32, 0, 0, 0, 0, time.UTC)
		day += 32 - t.Day()
		month--
	}
	if month < 0 {
		month += 12
		year--
	}
	return
}

func HumanizeRelTime(a time.Time, b time.Time, lang string) string {
	_, magnitudes := humanizeTimeMagnitudes(lang)
	return strings.TrimSpace(humanize.CustomRelTime(a, b, "", "", magnitudes))
}

func HumanizeTime(then time.Time, lang string) string {
	labels, magnitudes := humanizeTimeMagnitudes(lang)
	return strings.TrimSpace(humanize.CustomRelTime(then, time.Now(), labels["albl"].(string), labels["blbl"].(string), magnitudes))
}

func humanizeTimeMagnitudes(lang string) (labels map[string]interface{}, magnitudes []humanize.RelTimeMagnitude) {
	labels = TimeLangs[lang]
	magnitudes = []humanize.RelTimeMagnitude{
		{time.Second, labels["now"].(string), time.Second},
		{2 * time.Second, labels["1s"].(string), 1},
		{time.Minute, labels["xs"].(string), time.Second},
		{2 * time.Minute, labels["1m"].(string), 1},
		{time.Hour, labels["xm"].(string), time.Minute},
		{2 * time.Hour, labels["1h"].(string), 1},
		{humanize.Day, labels["xh"].(string), time.Hour},
		{2 * humanize.Day, labels["1d"].(string), 1},
		{humanize.Week, labels["xd"].(string), humanize.Day},
		{2 * humanize.Week, labels["1w"].(string), 1},
		{humanize.Month, labels["xw"].(string), humanize.Week},
		{2 * humanize.Month, labels["1M"].(string), 1},
		{humanize.Year, labels["xM"].(string), humanize.Month},
		{18 * humanize.Month, labels["1y"].(string), 1},
		{2 * humanize.Year, labels["2y"].(string), 1},
		{humanize.LongTime, labels["xy"].(string), humanize.Year},
		{math.MaxInt64, labels["max"].(string), 1},
	}
	return
}
