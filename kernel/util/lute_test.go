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

package util

import (
	"testing"

	"github.com/88250/lute"
	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
)

func TestLuteFactoriesEnableCustomBlock(t *testing.T) {
	factories := []struct {
		name string
		new  func() *lute.Lute
	}{
		{name: "SiYuan", new: NewLute},
		{name: "standard import", new: NewStdLute},
	}

	for _, factory := range factories {
		t.Run(factory.name, func(t *testing.T) {
			luteEngine := factory.new()
			tree := parse.Parse("", []byte(";;;example-plugin/chart\npayload\n;;;"), luteEngine.ParseOptions)
			if nil == tree || nil == tree.Root || nil == tree.Root.FirstChild {
				t.Fatal("custom block Markdown was not parsed")
			}
			node := tree.Root.FirstChild
			if ast.NodeCustomBlock != node.Type || "example-plugin/chart" != node.CustomBlockInfo || "payload\n" != string(node.Tokens) {
				t.Fatalf("unexpected custom block: type=%s, info=%q, content=%q", node.Type, node.CustomBlockInfo, node.Tokens)
			}
		})
	}
}
