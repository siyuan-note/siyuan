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

package av

import (
	"reflect"
	"testing"
)

func TestGetVisibleViewIDs(t *testing.T) {
	attrView := &AttributeView{Views: []*View{
		{ID: "view-a"},
		{ID: "view-b"},
		{ID: "view-c"},
	}}

	if actual := attrView.GetVisibleViewIDs(""); !reflect.DeepEqual(actual, []string{"view-a", "view-b", "view-c"}) {
		t.Fatalf("legacy visible views mismatch: %v", actual)
	}
	if actual := attrView.GetVisibleViewIDs("view-c,missing,view-a,view-c"); !reflect.DeepEqual(actual, []string{"view-a", "view-c"}) {
		t.Fatalf("normalized visible views mismatch: %v", actual)
	}
	if actual := attrView.GetVisibleViewIDs("missing"); !reflect.DeepEqual(actual, []string{"view-a"}) {
		t.Fatalf("fallback visible views mismatch: %v", actual)
	}
}
