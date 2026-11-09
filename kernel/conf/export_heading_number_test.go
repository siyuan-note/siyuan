// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package conf

import (
	"encoding/json"
	"testing"
)

func TestExportHeadingNumberDefaults(t *testing.T) {
	for _, input := range []string{`{}`, `{"headingNumber":null}`, `{"headingNumber":true}`, `{"headingNumber":false}`} {
		value := &Export{}
		if err := json.Unmarshal([]byte(input), value); err != nil {
			t.Fatal(err)
		}
		NormalizeExport(value)
		want := input == `{"headingNumber":true}`
		if value.HeadingNumber == nil || *value.HeadingNumber != want {
			t.Fatalf("incorrect default for %s", input)
		}
		data, err := json.Marshal(value)
		if err != nil {
			t.Fatal(err)
		}
		reloaded := &Export{}
		if err = json.Unmarshal(data, reloaded); err != nil || reloaded.HeadingNumber == nil || *reloaded.HeadingNumber != want {
			t.Fatalf("round trip: %s %v", data, err)
		}
	}
	if *NewExport().HeadingNumber || *NormalizeExport(nil).HeadingNumber {
		t.Fatal("new default must be false")
	}
}
