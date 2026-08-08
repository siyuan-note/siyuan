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
	"testing"

	"github.com/siyuan-note/siyuan/kernel/av"
)

func TestGetAttrViewViewToRemoveUsesOperationID(t *testing.T) {
	attrView := &av.AttributeView{Views: []*av.View{
		{ID: "view-a"},
		{ID: "view-b"},
	}}

	view, err := getAttrViewViewToRemove(attrView, &Operation{ID: "view-b", BlockID: "missing-block"})
	if nil != err {
		t.Fatalf("get target view failed: %s", err)
	}
	if "view-b" != view.ID {
		t.Fatalf("unexpected target view: %s", view.ID)
	}

	if _, err = getAttrViewViewToRemove(attrView, &Operation{ID: "missing-view"}); av.ErrViewNotFound != err {
		t.Fatalf("unexpected missing view error: %v", err)
	}
}
