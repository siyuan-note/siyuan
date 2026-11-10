// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package util

import (
	"encoding/json"
	"testing"
)

func TestNormalizeSysFontsJSON(t *testing.T) {
	for _, raw := range []string{"", "null", "{}", "[null]", `[{"family":"\n"}]`} {
		if got := NormalizeSysFontsJSON(raw); got != "[]" {
			t.Fatalf("invalid input %q: %s", raw, got)
		}
	}
	raw := `[{"family":" Zebra ","weight":0,"spacing":"unknown"},{"family":"Alpha","weight":700,"spacing":"monospace"},{"family":"alpha","weight":700,"aliases":["Localized"]}]`
	var fonts []*Font
	if err := json.Unmarshal([]byte(NormalizeSysFontsJSON(raw)), &fonts); err != nil {
		t.Fatal(err)
	}
	if len(fonts) != 2 || fonts[0].Family != "Alpha" || fonts[0].Weight != 700 || fonts[0].Spacing != "monospace" {
		t.Fatalf("unexpected normalization: %+v", fonts)
	}
	if fonts[1].Family != "Zebra" || fonts[1].Weight != 400 || fonts[1].Spacing != "" {
		t.Fatalf("unexpected defaults: %+v", fonts[1])
	}
	if NormalizeSysFontsJSON(NormalizeSysFontsJSON(raw)) != NormalizeSysFontsJSON(raw) {
		t.Fatal("normalization must be idempotent")
	}
}
