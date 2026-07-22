// SiYuan - Refactor your thinking
// Copyright (c) 2020-present, b3log.org

package model

import (
	"reflect"
	"strconv"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
)

func TestBuildHeadingNumberEntries(t *testing.T) {
	tree := newHeadingNumberTestTree(1, 3, 2, 4, 1)
	entries := buildHeadingNumberEntries(tree, "decimal-hierarchical")
	want := map[string]string{
		"heading-1": "1",
		"heading-2": "1.1",
		"heading-3": "1.2",
		"heading-4": "1.2.1",
		"heading-5": "2",
	}
	if got := headingNumberEntryLabels(entries); !reflect.DeepEqual(got, want) {
		t.Fatalf("unexpected heading numbers: got %v, want %v", got, want)
	}
}

func TestShouldReturnHeadingNumbers(t *testing.T) {
	for _, mode := range []int{0, 3} {
		if !shouldReturnHeadingNumbers(mode, false) {
			t.Fatalf("mode %d should return heading numbers", mode)
		}
	}
	for _, mode := range []int{1, 2, 4} {
		if shouldReturnHeadingNumbers(mode, false) {
			t.Fatalf("mode %d should not return heading numbers", mode)
		}
	}
	if shouldReturnHeadingNumbers(0, true) {
		t.Fatal("backlink rendering should not return heading numbers")
	}
}

func TestBuildHeadingNumberEntriesStartsFromLogicalRoot(t *testing.T) {
	tree := newHeadingNumberTestTree(3, 4, 2, 6)
	entries := buildHeadingNumberEntries(tree, "decimal-hierarchical")
	want := map[string]string{
		"heading-1": "1",
		"heading-2": "1.1",
		"heading-3": "2",
		"heading-4": "2.1",
	}
	if got := headingNumberEntryLabels(entries); !reflect.DeepEqual(got, want) {
		t.Fatalf("unexpected heading numbers: got %v, want %v", got, want)
	}
}

func TestBuildHeadingNumberEntriesExcludesOutlineContainers(t *testing.T) {
	root := &ast.Node{Type: ast.NodeDocument, ID: "root"}
	root.AppendChild(&ast.Node{Type: ast.NodeHeading, ID: "heading-1", HeadingLevel: 1})
	blockquote := &ast.Node{Type: ast.NodeBlockquote, ID: "blockquote"}
	blockquote.AppendChild(&ast.Node{Type: ast.NodeHeading, ID: "heading-2", HeadingLevel: 2})
	root.AppendChild(blockquote)
	root.AppendChild(&ast.Node{Type: ast.NodeHeading, ID: "heading-3", HeadingLevel: 2})

	entries := buildHeadingNumberEntries(&parse.Tree{Root: root}, "decimal-hierarchical")
	want := map[string]string{"heading-1": "1", "heading-3": "1.1"}
	if got := headingNumberEntryLabels(entries); !reflect.DeepEqual(got, want) {
		t.Fatalf("unexpected heading numbers: got %v, want %v", got, want)
	}
}

func TestHeadingNumberFormats(t *testing.T) {
	tests := []struct {
		name   string
		format string
		levels []int
		want   string
	}{
		{name: "upper alpha", format: "upper-alpha-hierarchical", levels: repeatHeadingLevel(1, 27), want: "AA"},
		{name: "lower greek", format: "lower-greek-hierarchical", levels: repeatHeadingLevel(1, 25), want: "αα"},
		{name: "upper roman", format: "upper-roman-hierarchical", levels: repeatHeadingLevel(1, 14), want: "XIV"},
		{name: "parenthesized", format: "decimal-parenthesized", levels: []int{1, 2, 3}, want: "1）"},
		{name: "chinese document", format: "chinese-document", levels: []int{1, 2, 3}, want: "1."},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			entries := buildHeadingNumberEntries(newHeadingNumberTestTree(test.levels...), test.format)
			lastID := "heading-" + strconv.Itoa(len(test.levels))
			if got := entries[lastID].Label; got != test.want {
				t.Fatalf("unexpected label: got %q, want %q", got, test.want)
			}
		})
	}
}

func TestHeadingNumberFormatPresets(t *testing.T) {
	tests := []struct {
		name   string
		format string
		path   []int
		want   string
	}{
		{name: "hierarchical", format: "decimal-hierarchical", path: []int{2, 3, 4}, want: "2.3.4"},
		{name: "per level first", format: "chinese-document", path: []int{2}, want: "二、"},
		{name: "per level second", format: "chinese-document", path: []int{2, 3}, want: "（三）"},
		{name: "per level third", format: "chinese-document", path: []int{2, 3, 4}, want: "4."},
		{name: "parenthesized", format: "decimal-parenthesized", path: []int{2, 3}, want: "3）"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := formatHeadingNumber(test.path, headingNumberPresetByID(test.format)); got != test.want {
				t.Fatalf("unexpected label: got %q, want %q", got, test.want)
			}
		})
	}
}

func TestChineseNumber(t *testing.T) {
	tests := map[int]string{
		1:        "一",
		10:       "十",
		11:       "十一",
		101:      "一百零一",
		10010:    "一万零一十",
		11000:    "一万一千",
		10010001: "一千零一万零一",
	}
	for number, want := range tests {
		if got := chineseNumber(number); got != want {
			t.Fatalf("unexpected Chinese number for %d: got %q, want %q", number, got, want)
		}
	}
}

func newHeadingNumberTestTree(levels ...int) *parse.Tree {
	root := &ast.Node{Type: ast.NodeDocument, ID: "root"}
	for i, level := range levels {
		root.AppendChild(&ast.Node{
			Type:         ast.NodeHeading,
			ID:           "heading-" + strconv.Itoa(i+1),
			HeadingLevel: level,
		})
	}
	return &parse.Tree{Root: root}
}

func repeatHeadingLevel(level, count int) []int {
	ret := make([]int, count)
	for i := range ret {
		ret[i] = level
	}
	return ret
}

func headingNumberEntryLabels(entries map[string]headingNumberEntry) map[string]string {
	ret := make(map[string]string, len(entries))
	for id, entry := range entries {
		ret[id] = entry.Label
	}
	return ret
}
