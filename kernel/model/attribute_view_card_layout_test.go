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
	"errors"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/av"
)

func TestGetAttrViewOperationView(t *testing.T) {
	first := &av.View{ID: "20260727120000-first"}
	second := &av.View{ID: "20260727120001-second"}
	attrView := &av.AttributeView{
		Views: []*av.View{first, second},
	}

	got, err := getAttrViewOperationView(attrView, &Operation{ViewID: second.ID})
	if nil != err {
		t.Fatalf("get specified view failed: %s", err)
	}
	if got != second {
		t.Fatalf("expected specified view [%s], got [%s]", second.ID, got.ID)
	}

	got, err = getAttrViewOperationView(attrView, &Operation{})
	if nil != err {
		t.Fatalf("get current view failed: %s", err)
	}
	if got != first {
		t.Fatalf("expected current view [%s], got [%s]", first.ID, got.ID)
	}

	_, err = getAttrViewOperationView(attrView, &Operation{ViewID: "20260727120002-missing"})
	if !errors.Is(err, av.ErrViewNotFound) {
		t.Fatalf("missing view returned error [%v]", err)
	}
}
