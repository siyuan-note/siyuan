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
)

func TestNormalizeMissingAssetLinkDest(t *testing.T) {
	tests := []struct {
		name string
		dest string
		want string
	}{
		{name: "asset", dest: "assets/image.png", want: "assets/image.png"},
		{name: "query", dest: "assets/document.pdf?page=2", want: "assets/document.pdf"},
		{name: "folder", dest: "assets/images/", want: ""},
		{name: "rtfd", dest: "assets/document.rtfd", want: ""},
		{name: "pdf annotation", dest: "assets/document.pdf/20200101000000-abcdefg", want: ""},
		{name: "external", dest: "https://example.com/image.png", want: ""},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := normalizeMissingAssetLinkDest(test.dest); got != test.want {
				t.Fatalf("normalize missing asset link destination: got %q, want %q", got, test.want)
			}
		})
	}
}

func TestGetAssetLinkDestsByNode(t *testing.T) {
	const blockID = "20200101000000-abcdefg"
	root := &ast.Node{Type: ast.NodeDocument}
	paragraph := &ast.Node{Type: ast.NodeParagraph, ID: blockID}
	paragraph.SetIALAttr("custom-data-assets", "assets/custom.png")
	linkDest := &ast.Node{Type: ast.NodeLinkDest, Tokens: []byte("assets/image.png")}
	root.AppendChild(paragraph)
	paragraph.AppendChild(linkDest)

	want := []string{"assets/custom.png", "assets/image.png"}
	if got := getAssetsLinkDests(root, false); !reflect.DeepEqual(got, want) {
		t.Fatalf("get asset link destinations: got %v, want %v", got, want)
	}
	if got := getAssetLinkDestsByNode(paragraph, false); !reflect.DeepEqual(got, []string{"assets/custom.png"}) {
		t.Fatalf("get block asset link destinations: got %v, want %v", got, []string{"assets/custom.png"})
	}
	if got := getAssetLinkDestsByNode(linkDest, false); !reflect.DeepEqual(got, []string{"assets/image.png"}) {
		t.Fatalf("get inline asset link destinations: got %v, want %v", got, []string{"assets/image.png"})
	}
	if got := assetLinkDestBlockID(linkDest); got != blockID {
		t.Fatalf("get asset link destination block ID: got %q, want %q", got, blockID)
	}
}
