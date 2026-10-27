// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

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
