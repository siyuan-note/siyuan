// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import "testing"

func TestBlockIsContainerBlock(t *testing.T) {
	for _, typ := range []string{"NodeDocument", "NodeBlockquote", "NodeList", "NodeListItem", "NodeSuperBlock", "NodeCallout", "NodeTabs", "NodeTabItem"} {
		block := &Block{Type: typ}
		if !block.IsContainerBlock() {
			t.Errorf("expected %q to be a container block", typ)
		}
	}
	for _, typ := range []string{"NodeHeading", "NodeParagraph", "NodeCodeBlock", "", "unknown"} {
		block := &Block{Type: typ}
		if block.IsContainerBlock() {
			t.Errorf("expected %q to be a leaf block", typ)
		}
	}
}
