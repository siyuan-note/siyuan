// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"slices"
	"testing"
)

func TestAppendBuiltinPandocDocxFilter(t *testing.T) {
	args := []string{
		"-f", "html+tex_math_dollars",
		"--lua-filter", "custom.lua",
		"--lua-filter=another.lua",
	}
	actual := appendBuiltinPandocDocxFilter(args, "siyuan-docx-filter.lua")
	expected := []string{
		"-f", "html+tex_math_dollars",
		"--lua-filter", "custom.lua",
		"--lua-filter=another.lua",
		"--lua-filter", "siyuan-docx-filter.lua",
	}
	if !slices.Equal(expected, actual) {
		t.Fatalf("unexpected Pandoc arguments:\nexpected: %q\nactual:   %q", expected, actual)
	}
}

func TestAppendBuiltinPandocDocxFilterWithoutCustomFilter(t *testing.T) {
	actual := appendBuiltinPandocDocxFilter([]string{"-t", "docx"}, "siyuan-docx-filter.lua")
	expected := []string{"-t", "docx", "--lua-filter", "siyuan-docx-filter.lua"}
	if !slices.Equal(expected, actual) {
		t.Fatalf("unexpected Pandoc arguments:\nexpected: %q\nactual:   %q", expected, actual)
	}
}
