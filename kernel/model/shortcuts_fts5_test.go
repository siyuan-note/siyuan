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
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestMoveLocalShorthandsIndexesInlineTags(t *testing.T) {
	const subprocessEnv = "SIYUAN_TEST_SHORTHAND_TAGS"
	if "1" != os.Getenv(subprocessEnv) {
		cmd := exec.Command(os.Args[0], "-test.run=^TestMoveLocalShorthandsIndexesInlineTags$", "-test.v")
		cmd.Env = append(os.Environ(), subprocessEnv+"=1")
		output, err := cmd.CombinedOutput()
		if nil != err {
			t.Fatalf("shorthand tag subprocess failed: %v\n%s", err, output)
		}
		return
	}

	fixture := setupFileOperationTest(t)
	util.TempDir = t.TempDir()
	util.QueueDir = filepath.Join(util.TempDir, "queue")
	util.ConfDir = filepath.Join(util.TempDir, "conf")
	util.ShortcutsPath = filepath.Join(util.TempDir, "shortcuts")
	util.DBPath = filepath.Join(util.TempDir, util.DBName)
	util.HistoryDBPath = filepath.Join(util.TempDir, "history.db")
	util.AssetContentDBPath = filepath.Join(util.TempDir, "asset_content.db")
	shorthandsDir := filepath.Join(util.ShortcutsPath, "shorthands")
	for _, dir := range []string{util.QueueDir, util.ConfDir, shorthandsDir} {
		if err := os.MkdirAll(dir, 0755); nil != err {
			t.Fatal(err)
		}
	}
	Conf.Lang = "en"
	Conf.Search = conf.NewSearch()
	util.WorkingDir = filepath.Clean(filepath.Join("..", "..", "app"))
	initLang()
	sql.InitDatabase(true)
	sql.InitHistoryDatabase(true)
	sql.InitAssetContentDatabase(true)
	t.Cleanup(sql.CloseDatabase)
	tree, err := filesys.LoadTree(fixture.box.ID, fixture.sourcePath, util.NewLute())
	if nil != err {
		t.Fatal(err)
	}
	treenode.UpsertBlockTree(tree)

	for i, tc := range []struct {
		name    string
		hPath   string
		suffix  string
		enabled bool
	}{
		{name: "existing", hPath: "/Source", enabled: true},
		{name: "existing-space", hPath: "/Source", suffix: " ", enabled: true},
		{name: "existing-newline", hPath: "/Source", suffix: "\n", enabled: true},
		{name: "new", hPath: "/New daily note", enabled: true},
		{name: "disabled", hPath: "/Source"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			Conf.FileTree.ShorthandSavePath = tc.hPath
			util.MarkdownSettings.InlineTag = tc.enabled
			created := time.Date(2026, 9, 8, 8, i, 0, 0, time.Local)
			label := "shorthand-" + tc.name
			md := "**bold** [link](https://example.com)\n\n测试#" + label + "#" + tc.suffix
			shorthandPath := filepath.Join(shorthandsDir, strconv.FormatInt(created.UnixMilli(), 10)+".md")
			if err := os.WriteFile(shorthandPath, []byte(md), 0644); nil != err {
				t.Fatal(err)
			}
			if _, err := MoveLocalShorthands(fixture.box.ID); nil != err {
				t.Fatal(err)
			}
			sql.FlushQueue()
			spans := sql.QueryTagSpansByLabel(label)
			want := 0
			if tc.enabled {
				want = 1
			}
			if len(spans) != want {
				t.Fatalf("tag index count: got %d, want %d", len(spans), want)
			}
			bt := treenode.GetBlockTreeRootByHPath(fixture.box.ID, tc.hPath)
			if nil == bt {
				t.Fatal("shorthand document missing")
			}
			cache.RemoveTreeDataInBox(bt.ID, bt.BoxID)
			persisted, err := loadTreeByBlockTree(bt)
			if nil != err {
				t.Fatal(err)
			}
			marks := map[string]bool{}
			blockCount := 0
			createdPrefix := created.Format("20060102150405")
			ast.Walk(persisted.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
				if !entering {
					return ast.WalkContinue
				}
				if ast.NodeDocument == n.Type {
					return ast.WalkContinue
				}
				if n.IsBlock() {
					if !strings.HasPrefix(n.ID, createdPrefix) {
						return ast.WalkSkipChildren
					}
					blockCount++
					if n.IALAttr("id") != n.ID || n.IALAttr("updated") != n.ID[:14] {
						t.Fatalf("shorthand block timestamps were not preserved: %s", n.ID)
					}
				}
				if ast.NodeTag == n.Type {
					t.Fatal("persisted document contains an unnormalized tag")
				}
				if ast.NodeTextMark == n.Type {
					for _, typ := range []string{"strong", "a"} {
						if n.IsTextMarkType(typ) {
							marks[typ] = true
						}
					}
				}
				return ast.WalkContinue
			})
			if 2 != blockCount {
				t.Fatalf("expected two shorthand paragraphs with original timestamps, got %d", blockCount)
			}
			if !marks["strong"] || !marks["a"] {
				t.Fatalf("inline formatting missing: %v", marks)
			}
			if tc.enabled && (spans[0].RootID != bt.ID || !strings.HasPrefix(spans[0].BlockID, created.Format("20060102150405"))) {
				t.Fatalf("unexpected tag location: %+v", spans[0])
			}
			if _, err := os.Stat(shorthandPath); !os.IsNotExist(err) {
				t.Fatalf("consumed shorthand was not removed: %v", err)
			}
		})
	}
}
