// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package apicontract

import (
	"strings"
	"testing"
)

func TestDailyNoteInfoContract(t *testing.T) {
	for _, entry := range []struct {
		body  string
		valid bool
	}{
		{`{"notebook":"box"}`, true},
		{`{"notebook":"box","date":null}`, true},
		{`{"notebook":"box","date":"2024-02-29"}`, true},
		{`{"date":"2024-02-29"}`, false},
		{`{"notebook":"box","date":false}`, false},
	} {
		_, err := GetDailyNoteInfo.Decode(strings.NewReader(entry.body))
		if (err == nil) != entry.valid {
			t.Fatalf("unexpected input admission: %s %v", entry.body, err)
		}
	}
}
