// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package filesys

import (
	"strings"
	"testing"
)

func TestValidateContentStatContent(t *testing.T) {
	if err := ValidateContentStatContent(strings.Repeat("x", 1<<20)); nil != err {
		t.Fatalf("flat text within the limit was rejected: %v", err)
	}

	if err := ValidateContentStatContent(strings.Repeat("x", maxContentStatBytes+1)); errContentStatTooLarge != err {
		t.Fatalf("oversized content was not rejected: %v", err)
	}

	nested := strings.Repeat("<div>", maxContentStatDepth+1) + strings.Repeat("</div>", maxContentStatDepth+1)
	if err := ValidateContentStatContent(nested); errContentStatTooDeep != err {
		t.Fatalf("deeply nested content was not rejected: %v", err)
	}

	balanced := strings.Repeat("<div>", maxContentStatDepth) + "x" + strings.Repeat("</div>", maxContentStatDepth)
	if err := ValidateContentStatContent(balanced); nil != err {
		t.Fatalf("nesting at the limit was rejected: %v", err)
	}

	if err := ValidateContentStatContent(strings.Repeat("<br>", maxContentStatDepth*4)); nil != err {
		t.Fatalf("void elements were counted as nesting: %v", err)
	}

	if err := ValidateContentStatContent(strings.Repeat("<div/>", maxContentStatDepth*4)); nil != err {
		t.Fatalf("self-closing elements were counted as nesting: %v", err)
	}

	comment := "<!--" + strings.Repeat("<div>", maxContentStatDepth*4) + "-->"
	if err := ValidateContentStatContent(comment); nil != err {
		t.Fatalf("comment content was counted as nesting: %v", err)
	}

	document := "<div><p>text</p><p><span>inline</span></p></div>"
	if err := ValidateContentStatContent(document); nil != err {
		t.Fatalf("ordinary BlockDOM was rejected: %v", err)
	}
}
