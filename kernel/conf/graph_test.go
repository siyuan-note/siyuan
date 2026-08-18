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
