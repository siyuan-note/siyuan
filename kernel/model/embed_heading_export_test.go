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

//go:build fts5

package model

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/88250/lute"
	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestExportExplicitEmbedHeadingLevels(t *testing.T) {
	const boxID = "20260914010000-box0001"
	const docID = "20260914010001-doc0001"
	const headingID = "20260914010002-heading"
	oldConfDir := util.ConfDir
	util.ConfDir = t.TempDir()
	t.Cleanup(func() { util.ConfDir = oldConfDir })
	setupExportRelatedTest(t, boxID)
	Conf.Editor = conf.NewEditor()
	Conf.Search = conf.NewSearch()
	oldDB, oldQueue := util.DBPath, util.QueueDir
	oldHistoryDB, oldAssetDB := util.HistoryDBPath, util.AssetContentDBPath
	util.DBPath = filepath.Join(util.TempDir, "siyuan.db")
	util.HistoryDBPath = filepath.Join(util.TempDir, "history.db")
	util.AssetContentDBPath = filepath.Join(util.TempDir, "asset_content.db")
	util.QueueDir = filepath.Join(util.TempDir, "queue")
	if err := os.MkdirAll(util.QueueDir, 0755); err != nil {
		t.Fatal(err)
	}
	sql.InitDatabase(true)
	sql.InitHistoryDatabase(true)
	sql.InitAssetContentDatabase(true)
	t.Cleanup(func() {
		sql.CloseDatabase()
		util.DBPath, util.QueueDir = oldDB, oldQueue
		util.HistoryDBPath, util.AssetContentDBPath = oldHistoryDB, oldAssetDB
	})
	tree := treenode.NewTree(boxID, "/"+docID+".sy", "/Source", "Source")
	for tree.Root.FirstChild != nil {
		tree.Root.FirstChild.Unlink()
	}
	for index, level := range []int{2, 3, 5} {
		heading := &ast.Node{Type: ast.NodeHeading, HeadingLevel: level, ID: ast.NewNodeID()}
		if index == 0 {
			heading.ID = headingID
		}
		heading.SetIALAttr("id", heading.ID)
		heading.AppendChild(&ast.Node{Type: ast.NodeHeadingC8hMarker, Tokens: []byte(strings.Repeat("#", level))})
		heading.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte([]string{"A", "B", "C"}[index])})
		tree.Root.AppendChild(heading)
	}
	writeExportRelatedTestTree(t, tree)
	sql.IndexTreeQueue(tree)
	sql.FlushQueue()
	for _, mode := range []int{0, 1} {
		for _, setting := range []struct {
			name        string
			level       string
			headingMode string
			want        []string
		}{
			{"explicit", "5", "2", []string{"##### B", "**C**"}},
			{"preserve children", "", "2", []string{"### B", "##### C"}},
			{"preserve all", "", "0", []string{"## A", "### B", "##### C"}},
			{"preserve title", "", "1", []string{"## A"}},
			{"invalid preserves", "invalid", "2", []string{"### B", "##### C"}},
		} {
			t.Run([]string{"original", "blockquote"}[mode]+"/"+setting.name, func(t *testing.T) {
				root := &ast.Node{Type: ast.NodeDocument}
				parentHeading := &ast.Node{Type: ast.NodeHeading, HeadingLevel: 6}
				parentHeading.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("Host")})
				root.AppendChild(parentHeading)
				embed := &ast.Node{Type: ast.NodeBlockQueryEmbed, ID: ast.NewNodeID()}
				embed.SetIALAttr("custom-heading-mode", setting.headingMode)
				if setting.level != "" {
					embed.SetIALAttr(embedHeadingLevelAttr, setting.level)
				}
				embed.AppendChild(&ast.Node{Type: ast.NodeBlockQueryEmbedScript, Tokens: []byte("select * from blocks where id='" + headingID + "'")})
				root.AppendChild(embed)
				depth := 0
				engine := lute.New()
				resolveEmbedR(root, mode, engine, &[]string{}, &depth)
				md, _ := lute.FormatNodeSync(root, engine.ParseOptions, engine.RenderOptions)
				normalized := "\n" + strings.ReplaceAll(md, "> ", "") + "\n"
				for _, want := range setting.want {
					if !strings.Contains(normalized, "\n"+want+"\n") {
						t.Fatalf("unexpected export: %s", md)
					}
				}
				if setting.headingMode == "2" && strings.Contains(md, " A") {
					t.Fatalf("hidden heading exported: %s", md)
				}
				if (mode == 1) != (root.LastChild.Type == ast.NodeBlockquote) {
					t.Fatalf("unexpected export container: %s", md)
				}
			})
		}
	}
	loaded, err := LoadTreeByBlockID(headingID)
	if err != nil || treenode.GetNodeInTree(loaded, headingID).HeadingLevel != 2 {
		t.Fatalf("source heading changed: %v", err)
	}
}
