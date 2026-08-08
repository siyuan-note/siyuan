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

package util

import (
	"testing"
	"time"
)

func TestHumanizeRelTimeMinuteMagnitude(t *testing.T) {
	const lang = "humanize-relative-time-test"
	oldTimeLang, hadTimeLang := TimeLangs[lang]
	TimeLangs[lang] = map[string]any{
		"albl": "ago",
		"blbl": "from now",
		"now":  "now",
		"1s":   "1 second %s",
		"xs":   "%d seconds %s",
		"1m":   "1 minute %s",
		"xm":   "%d minutes %s",
		"1h":   "1 hour %s",
		"xh":   "%d hours %s",
		"1d":   "1 day %s",
		"xd":   "%d days %s",
		"1w":   "1 week %s",
		"xw":   "%d weeks %s",
		"1M":   "1 month %s",
		"xM":   "%d months %s",
		"1y":   "1 year %s",
		"2y":   "2 years %s",
		"xy":   "%d years %s",
		"max":  "a long while %s",
	}
	t.Cleanup(func() {
		if hadTimeLang {
			TimeLangs[lang] = oldTimeLang
		} else {
			delete(TimeLangs, lang)
		}
	})

	start := time.Unix(0, 0)
	tests := []struct {
		name     string
		duration time.Duration
		expected string
	}{
		{name: "two minutes", duration: 2 * time.Minute, expected: "2 minutes"},
		{name: "less than one hour", duration: time.Hour - time.Second, expected: "59 minutes"},
		{name: "one hour", duration: time.Hour, expected: "1 hour"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			actual := HumanizeRelTime(start, start.Add(test.duration), lang)
			if actual != test.expected {
				t.Fatalf("unexpected relative time: %q", actual)
			}
		})
	}
}
