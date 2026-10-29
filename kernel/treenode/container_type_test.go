// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package treenode

import "testing"

func TestIsContainerType(t *testing.T) {
	for _, typ := range []string{"d", "b", "l", "i", "s", "callout", "tabs", "tab", "mindmap", "mindmap_item"} {
		if !IsContainerType(typ) {
			t.Errorf("expected %q to accept child blocks", typ)
		}
	}
	for _, typ := range []string{"h", "p", "c", "", "unknown"} {
		if IsContainerType(typ) {
			t.Errorf("expected %q to reject direct child writes", typ)
		}
	}
}
