// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

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
