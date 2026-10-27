// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package documentaddressing

import (
	"errors"
	"strings"
	"testing"
)

func TestTitlePropertiesPreserveUnknownSources(t *testing.T) {
	for _, source := range []string{
		`{"title":{"format":"future","content":"private"}}`,
		`{"title":["private"]}`,
		`{"title":42,"title":"ordinary"}`,
		`{"title":false}`,
		`{"title":"ordinary"} {}`,
	} {
		if _, err := CheckTitleProperties([]byte(source)); !errors.Is(err, ErrInvalidTitle) || strings.Contains(err.Error(), "private") {
			t.Fatalf("unknown title was accepted or exposed: %v", err)
		}
	}
	for _, source := range []string{
		`{"title":null}`, `null`, `{}`, `{"title":"ordinary","other":"A/B"}`,
		`{"title":"A&amp;#47;B"}`, `{"title":"A%2FB／C **literal**"}`,
	} {
		if _, err := CheckTitleProperties([]byte(source)); err != nil {
			t.Fatal("legacy title semantics changed", err)
		}
	}
}
