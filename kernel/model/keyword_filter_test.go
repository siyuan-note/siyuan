// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"reflect"
	"testing"
)

func TestExcludeKeywords(t *testing.T) {
	keywords := []string{"work", "test", "entropy", "foo123", "/"}
	excludes := "work, /^test$/\n/[0-9]+/,/"
	want := []string{"entropy"}

	if got := excludeKeywords(keywords, excludes); !reflect.DeepEqual(got, want) {
		t.Fatalf("excludeKeywords() = %q, want %q", got, want)
	}
}

func TestExcludeKeywordsIgnoresInvalidRegexp(t *testing.T) {
	keywords := []string{"work", "test"}
	want := []string{"work", "test"}

	if got := excludeKeywords(keywords, "/[/"); !reflect.DeepEqual(got, want) {
		t.Fatalf("excludeKeywords() = %q, want %q", got, want)
	}
}
