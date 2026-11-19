// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"testing"

	"github.com/siyuan-note/siyuan/kernel/av"
)

func TestAVIconContractMapping(t *testing.T) {
	for _, primary := range []bool{false, true} {
		for _, relation := range []*bool{nil, new(false), new(true)} {
			base := &av.BaseLayout{ShowIcon: primary, ShowRelationIcon: relation}
			mapped := toContractAVBaseLayout(base)
			if mapped.ShowIcon != primary || (mapped.ShowRelationIcon == nil) != (relation == nil) {
				t.Fatal("stored layout mapping changed icon settings")
			}
			if relation != nil && *mapped.ShowRelationIcon != *relation {
				t.Fatal("explicit relation setting changed")
			}
			view := &av.View{LayoutType: av.LayoutTypeTable, Table: &av.LayoutTable{BaseLayout: base}}
			instance := toContractAVBaseInstance(av.NewViewBaseInstance(view))
			if instance.ShowIcon != primary || instance.ShowRelationIcon != base.EffectiveShowRelationIcon() {
				t.Fatal("rendered icon settings changed")
			}
		}
	}
}
