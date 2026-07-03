// SiYuan - Refactor your thinking
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
	"reflect"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
)

func TestHeadingNumbersSkippedLevels(t *testing.T) {
	tree := &parse.Tree{Root: &ast.Node{ID: "root", Type: ast.NodeDocument}}
	tree.Root.AppendChild(&ast.Node{ID: "h3-first", Type: ast.NodeHeading, HeadingLevel: 3})
	tree.Root.AppendChild(&ast.Node{ID: "h2-first", Type: ast.NodeHeading, HeadingLevel: 2})
	tree.Root.AppendChild(&ast.Node{ID: "h4-first", Type: ast.NodeHeading, HeadingLevel: 4})
	tree.Root.AppendChild(&ast.Node{ID: "h1-first", Type: ast.NodeHeading, HeadingLevel: 1})
	tree.Root.AppendChild(&ast.Node{ID: "h3-second", Type: ast.NodeHeading, HeadingLevel: 3})

	blockquote := &ast.Node{ID: "bq", Type: ast.NodeBlockquote}
	blockquote.AppendChild(&ast.Node{ID: "h1-quote", Type: ast.NodeHeading, HeadingLevel: 1})
	tree.Root.AppendChild(blockquote)

	callout := &ast.Node{ID: "callout", Type: ast.NodeCallout}
	callout.AppendChild(&ast.Node{ID: "h1-callout", Type: ast.NodeHeading, HeadingLevel: 1})
	tree.Root.AppendChild(callout)

	expected := map[string]string{
		"h3-first":  "0.0.1",
		"h2-first":  "0.1",
		"h4-first":  "0.1.0.1",
		"h1-first":  "1",
		"h3-second": "1.0.1",
	}
	if actual := HeadingNumbers(tree); !reflect.DeepEqual(expected, actual) {
		t.Fatalf("unexpected heading numbers\nexpected: %#v\nactual: %#v", expected, actual)
	}
}

func TestHeadingNumbersUsesHighestPresentHeadingAsRoot(t *testing.T) {
	tree := &parse.Tree{Root: &ast.Node{ID: "root", Type: ast.NodeDocument}}
	tree.Root.AppendChild(&ast.Node{ID: "h4-first", Type: ast.NodeHeading, HeadingLevel: 4})
	tree.Root.AppendChild(&ast.Node{ID: "h2-first", Type: ast.NodeHeading, HeadingLevel: 2})
	tree.Root.AppendChild(&ast.Node{ID: "h2-second", Type: ast.NodeHeading, HeadingLevel: 2})
	tree.Root.AppendChild(&ast.Node{ID: "h3-first", Type: ast.NodeHeading, HeadingLevel: 3})

	expected := map[string]string{
		"h4-first":  "0.0.1",
		"h2-first":  "1",
		"h2-second": "2",
		"h3-first":  "2.1",
	}
	if actual := HeadingNumbers(tree); !reflect.DeepEqual(expected, actual) {
		t.Fatalf("unexpected heading numbers\nexpected: %#v\nactual: %#v", expected, actual)
	}
}

func TestHeadingNumbersExcludedContainersDoNotAffectRoot(t *testing.T) {
	tree := &parse.Tree{Root: &ast.Node{ID: "root", Type: ast.NodeDocument}}

	blockquote := &ast.Node{ID: "bq", Type: ast.NodeBlockquote}
	blockquote.AppendChild(&ast.Node{ID: "h1-quote", Type: ast.NodeHeading, HeadingLevel: 1})
	blockquoteList := &ast.Node{ID: "bq-list", Type: ast.NodeList}
	blockquoteListItem := &ast.Node{ID: "bq-list-item", Type: ast.NodeListItem}
	blockquoteListItem.AppendChild(&ast.Node{ID: "h1-nested-quote", Type: ast.NodeHeading, HeadingLevel: 1})
	blockquoteList.AppendChild(blockquoteListItem)
	blockquote.AppendChild(blockquoteList)
	tree.Root.AppendChild(blockquote)

	callout := &ast.Node{ID: "callout", Type: ast.NodeCallout}
	callout.AppendChild(&ast.Node{ID: "h2-callout", Type: ast.NodeHeading, HeadingLevel: 2})
	calloutSuperBlock := &ast.Node{ID: "callout-super-block", Type: ast.NodeSuperBlock}
	calloutSuperBlock.AppendChild(&ast.Node{ID: "h2-nested-callout", Type: ast.NodeHeading, HeadingLevel: 2})
	callout.AppendChild(calloutSuperBlock)
	tree.Root.AppendChild(callout)

	embed := &ast.Node{ID: "embed", Type: ast.NodeBlockQueryEmbed}
	embed.AppendChild(&ast.Node{ID: "h1-embed", Type: ast.NodeHeading, HeadingLevel: 1})
	tree.Root.AppendChild(embed)

	tree.Root.AppendChild(&ast.Node{ID: "h3-first", Type: ast.NodeHeading, HeadingLevel: 3})
	tree.Root.AppendChild(&ast.Node{ID: "h4-first", Type: ast.NodeHeading, HeadingLevel: 4})

	expected := map[string]string{
		"h3-first": "1",
		"h4-first": "1.1",
	}
	if actual := HeadingNumbers(tree); !reflect.DeepEqual(expected, actual) {
		t.Fatalf("unexpected heading numbers\nexpected: %#v\nactual: %#v", expected, actual)
	}
}
