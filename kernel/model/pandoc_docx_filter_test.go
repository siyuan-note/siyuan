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
