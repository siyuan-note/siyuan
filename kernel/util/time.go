// SiYuan - Build Your Eternal Digital Garden
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
