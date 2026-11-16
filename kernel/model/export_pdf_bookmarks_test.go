// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5

package model

import (
	"fmt"
	"reflect"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
)

func TestPDFBookmarksWithMissingHeadings(t *testing.T) {
	setupExportPublishTest(t)
	const boxID = "20261115230000-pdfbox1"
	tests := []struct {
		name    string
		levels  []int
		folded  []int
		visible []int
		want    []string
	}{
		{
			name:   "folded parent hides nested headings",
			levels: []int{1, 2, 3, 1, 2}, folded: []int{0},
			want: []string{"1 Heading 0", "Heading 3", "  Heading 4"},
		},
		{
			name:   "folded child preserves following sibling and root",
			levels: []int{1, 2, 3, 2, 1, 2}, folded: []int{1},
			want: []string{"1 Heading 0", "  Heading 1", "  Heading 3", "Heading 4", "  Heading 5"},
		},
		{
			name:   "unfolded document includes all headings",
			levels: []int{1, 2, 3, 2, 1}, visible: []int{0, 1, 2, 3, 4},
			want: []string{"1 Heading 0", "  Heading 1", "    Heading 2", "  Heading 3", "Heading 4"},
		},
		{
			name:   "missing initial headings",
			levels: []int{1, 2, 1}, visible: []int{2}, want: []string{"Heading 2"},
		},
		{
			name:   "missing sibling promotes descendants to the visible ancestor",
			levels: []int{1, 2, 2, 3, 2}, visible: []int{0, 1, 3, 4},
			want: []string{"1 Heading 0", "  Heading 1", "  Heading 3", "  Heading 4"},
		},
		{
			name:   "missing root does not attach descendants to the preceding root",
			levels: []int{1, 1, 2}, visible: []int{0, 2},
			want: []string{"1 Heading 0", "Heading 2"},
		},
		{
			name:   "all headings visible with skipped levels",
			levels: []int{2, 4, 2}, visible: []int{0, 1, 2},
			want: []string{"1 Heading 0", "  Heading 1", "Heading 2"},
		},
		{name: "no heading links", levels: []int{1, 2}},
	}
	for index, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			docID := fmt.Sprintf("202611152301%02d-pdfdoc1", index)
			tree := treenode.NewTree(boxID, "/"+docID+".sy", "/PDF", "PDF")
			var headings []*ast.Node
			for i, level := range tt.levels {
				heading := &ast.Node{Type: ast.NodeHeading, ID: fmt.Sprintf("202611152302%02d-pdf%04d", i, index),
					HeadingLevel: level}
				heading.SetIALAttr("id", heading.ID)
				heading.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte(fmt.Sprintf("Heading %d", i))})
				tree.Root.AppendChild(heading)
				headings = append(headings, heading)
			}
			visible := tt.visible
			if len(tt.folded) > 0 {
				for _, i := range tt.folded {
					headings[i].SetIALAttr("fold", "1")
				}
				hidden := map[*ast.Node]bool{}
				for _, node := range treenode.CollectFoldHiddenNodes(tree.Root) {
					hidden[node] = true
				}
				for i, heading := range headings {
					if !hidden[heading] {
						visible = append(visible, i)
					}
				}
			}
			sql.IndexTreeQueue(tree)
			sql.FlushQueue()
			var links []string
			for _, i := range visible {
				links = append(links, PdfOutlineScheme+"://"+headings[i].ID)
			}
			ctx := pdfAssetTestContext(t, links...)
			if _, err := pdfcpu.RemoveBookmarks(ctx); err != nil {
				t.Fatal(err)
			}
			processPDFBookmarks(ctx, headings, map[string]string{headings[0].ID: "1"}, boxID)
			ctx = roundTripPDFAssetContext(t, ctx)
			bookmarks, err := pdfcpu.Bookmarks(ctx)
			if err != nil {
				t.Fatal(err)
			}
			var got []string
			var collect func([]*pdfcpu.Bookmark, string)
			collect = func(items []*pdfcpu.Bookmark, indent string) {
				for _, bookmark := range items {
					got = append(got, indent+bookmark.Title)
					collect(bookmark.Kids, indent+"  ")
				}
			}
			collect(bookmarks, "")
			if !reflect.DeepEqual(got, tt.want) {
				t.Fatalf("bookmarks = %v, want %v", got, tt.want)
			}
		})
	}
}
