// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package conf

import "testing"

func TestNormalizeGraphMaxBlocks(t *testing.T) {
	if defaultGraphMaxBlocks != NewGraph().MaxBlocks {
		t.Fatalf("expected new graph limit to be %d", defaultGraphMaxBlocks)
	}

	graph := &Graph{MaxBlocks: legacyGraphMaxBlocks}
	graph.NormalizeMaxBlocks()
	if defaultGraphMaxBlocks != graph.MaxBlocks {
		t.Fatalf("expected legacy limit to migrate to %d, got %d", defaultGraphMaxBlocks, graph.MaxBlocks)
	}

	graph.MaxBlocks = 0
	graph.NormalizeMaxBlocks()
	if defaultGraphMaxBlocks != graph.MaxBlocks {
		t.Fatalf("expected invalid limit to normalize to %d, got %d", defaultGraphMaxBlocks, graph.MaxBlocks)
	}

	const customLimit = 20_000
	graph.MaxBlocks = customLimit
	graph.NormalizeMaxBlocks()
	if customLimit != graph.MaxBlocks {
		t.Fatalf("expected custom limit to remain %d, got %d", customLimit, graph.MaxBlocks)
	}
}
