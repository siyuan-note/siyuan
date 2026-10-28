// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

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
