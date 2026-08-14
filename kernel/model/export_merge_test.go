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

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
)

func TestMergedDocHeadingLevel(t *testing.T) {
	tests := []struct {
		name         string
		depth        int
		mode         string
		addRootTitle bool
		expected     int
	}{
		{name: "legacy starts direct children at h1", depth: 1, addRootTitle: true, expected: 1},
		{name: "flat keeps deep documents at h1", depth: 5, mode: MergeDocHeadingModeFlat, addRootTitle: true, expected: 1},
		{name: "tree includes exported root title", depth: 1, mode: MergeDocHeadingModeTree, addRootTitle: true, expected: 2},
		{name: "tree starts at h1 without exported root title", depth: 1, mode: MergeDocHeadingModeTree, expected: 1},
		{name: "tree caps deep documents at h6", depth: 8, mode: MergeDocHeadingModeTree, addRootTitle: true, expected: 6},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if actual := mergedDocHeadingLevel(test.depth, test.mode, test.addRootTitle); test.expected != actual {
				t.Fatalf("expected heading level %d, got %d", test.expected, actual)
			}
		})
	}
}

func TestDemoteMergedContentHeadings(t *testing.T) {
	tree, headings := newMergeHeadingTestTree(1, 3)
	quote := &ast.Node{Type: ast.NodeBlockquote}
	quotedHeading := &ast.Node{Type: ast.NodeHeading, HeadingLevel: 1}
	quote.AppendChild(quotedHeading)
	tree.Root.AppendChild(quote)

	demoteMergedContentHeadings(tree, 2)

	if 3 != headings[0].HeadingLevel || 5 != headings[1].HeadingLevel {
		t.Fatalf("expected content headings [3 5], got [%d %d]", headings[0].HeadingLevel, headings[1].HeadingLevel)
	}
	if 1 != quotedHeading.HeadingLevel {
		t.Fatalf("expected quoted heading to remain h1, got h%d", quotedHeading.HeadingLevel)
	}
}

func TestDemoteMergedContentHeadingsKeepsLowerHeadings(t *testing.T) {
	tree, headings := newMergeHeadingTestTree(4, 6)

	demoteMergedContentHeadings(tree, 2)

	if 4 != headings[0].HeadingLevel || 6 != headings[1].HeadingLevel {
		t.Fatalf("expected content headings [4 6], got [%d %d]", headings[0].HeadingLevel, headings[1].HeadingLevel)
	}
}

func TestDemoteMergedContentHeadingsCapsAtH6(t *testing.T) {
	tree, headings := newMergeHeadingTestTree(1, 2)

	demoteMergedContentHeadings(tree, 6)

	if 6 != headings[0].HeadingLevel || 6 != headings[1].HeadingLevel {
		t.Fatalf("expected content headings [6 6], got [%d %d]", headings[0].HeadingLevel, headings[1].HeadingLevel)
	}
}

func TestMergeHeadingOptionsDefault(t *testing.T) {
	options := mergeHeadingOptionsOrDefault([]MergeHeadingOptions{{
		DocHeadingMode:     "unknown",
		ContentHeadingMode: "unknown",
	}})

	if "" != options.DocHeadingMode {
		t.Fatalf("expected legacy document heading mode, got %q", options.DocHeadingMode)
	}
	if MergeContentHeadingModePreserve != options.ContentHeadingMode {
		t.Fatalf("expected preserve content heading mode, got %q", options.ContentHeadingMode)
	}
}

func newMergeHeadingTestTree(levels ...int) (tree *parse.Tree, headings []*ast.Node) {
	root := &ast.Node{Type: ast.NodeDocument}
	for _, level := range levels {
		heading := &ast.Node{Type: ast.NodeHeading, HeadingLevel: level}
		root.AppendChild(heading)
		headings = append(headings, heading)
	}
	return &parse.Tree{Root: root}, headings
}
