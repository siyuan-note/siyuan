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

import "testing"

func TestMatchAttributeViewSearchName(t *testing.T) {
	tests := []struct {
		name     string
		keywords []string
		hit      bool
	}{
		{name: "Schedule", keywords: []string{"schedule"}, hit: true},
		{name: "状态：进行", keywords: []string{"状态", "进行"}, hit: true},
		{name: "状态：进行", keywords: []string{"状态", "结束"}, hit: false},
		{name: "Database View", keywords: []string{"DATA", "view"}, hit: true},
		{name: "", keywords: []string{"view"}, hit: false},
		{name: "View", keywords: nil, hit: false},
	}

	for _, test := range tests {
		score, hit := matchAttributeViewSearchName(test.name, test.keywords)
		if hit != test.hit {
			t.Fatalf("unexpected match result for %q and %v: %v", test.name, test.keywords, hit)
		}
		if hit && score <= 0 {
			t.Fatalf("expected positive score for %q and %v", test.name, test.keywords)
		}
	}
}
