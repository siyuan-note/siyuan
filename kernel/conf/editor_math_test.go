// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package conf

import (
	"encoding/json"
	"testing"
)

func TestEditorMathDelimiterCompatibility(t *testing.T) {
	if value := NewEditor().MathDelimiterCompatibility; value == nil || !*value {
		t.Fatal("new configurations must enable delimiter compatibility")
	}
	for _, tc := range []struct {
		input string
		want  bool
	}{
		{`{}`, true}, {`{"mathDelimiterCompatibility":null}`, true},
		{`{"mathDelimiterCompatibility":true}`, true}, {`{"mathDelimiterCompatibility":false}`, false},
	} {
		var editor Editor
		if err := json.Unmarshal([]byte(tc.input), &editor); err != nil {
			t.Fatal(err)
		}
		NormalizeEditor(&editor)
		if editor.MathDelimiterCompatibility == nil || *editor.MathDelimiterCompatibility != tc.want {
			t.Fatalf("unexpected compatibility for %s: %+v", tc.input, editor.MathDelimiterCompatibility)
		}
		data, err := json.Marshal(editor)
		if err != nil {
			t.Fatal(err)
		}
		var reloaded Editor
		if err = json.Unmarshal(data, &reloaded); err != nil {
			t.Fatal(err)
		}
		if *NormalizeEditor(&reloaded).MathDelimiterCompatibility != tc.want {
			t.Fatalf("saved preference changed after reload: %s", data)
		}
	}
}
