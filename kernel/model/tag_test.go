// SiYuan - Refactor your thinking
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
	"maps"
	"slices"
	"testing"
)

func TestFilterTagLabels(t *testing.T) {
	tests := []struct {
		name     string
		keyword  string
		expected []string
	}{
		{"empty", "", []string{"Project/Status/Todo", "Project/Topic", "资料/项目"}},
		{"whitespace", "  ", []string{"Project/Status/Todo", "Project/Topic", "资料/项目"}},
		{"case insensitive", "status", []string{"Project/Status/Todo"}},
		{"multiple keywords", "project todo", []string{"Project/Status/Todo"}},
		{"multiple spaces", " project   topic ", []string{"Project/Topic"}},
		{"all keywords required", "project done", nil},
		{"unicode", "资料 项目", []string{"资料/项目"}},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			labels := map[string]Tags{
				"Project/Status/Todo": {{}, {}},
				"Project/Topic":       {{}},
				"资料/项目":               {},
			}
			filterTagLabels(labels, test.keyword)
			actual := slices.Sorted(maps.Keys(labels))
			expected := slices.Clone(test.expected)
			slices.Sort(expected)
			if !slices.Equal(actual, expected) {
				t.Fatalf("expected labels %v, got %v", expected, actual)
			}
			if _, ok := labels["Project/Status/Todo"]; ok && len(labels["Project/Status/Todo"]) != 2 {
				t.Fatal("filtering should preserve tag counts")
			}
		})
	}
}
