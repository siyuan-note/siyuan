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
	"fmt"
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

func TestMoveLocalShorthandsMarkdownSettings(t *testing.T) {
	const subprocessEnv = "SIYUAN_TEST_SHORTHAND_MARKDOWN"
	if "1" != os.Getenv(subprocessEnv) {
		cmd := exec.Command(os.Args[0], "-test.run=^TestMoveLocalShorthandsMarkdownSettings$", "-test.v")
		cmd.Env = append(os.Environ(), subprocessEnv+"=1")
		output, err := cmd.CombinedOutput()
		if nil != err {
			t.Fatalf("shorthand markdown subprocess failed: %v\n%s", err, output)
		}
		return
	}

	fixture, shorthandsDir := setupShorthandMarkdownTest(t)
	caseIndex := 0
	for _, route := range []string{"separate", "merged", "append"} {
		for _, enabled := range []bool{true, false} {
			t.Run(fmt.Sprintf("%s/enabled=%t", route, enabled), func(t *testing.T) {
				settings := shorthandMarkdownTestSettings(enabled)
				util.MarkdownSettings = settings
				Conf.Editor.Markdown = settings
				created := time.Date(2026, 9, 9, 8, caseIndex, 0, 0, time.Local)
				caseIndex++
				secondCreated := created.Add(11 * time.Second)
				label := fmt.Sprintf("shorthand-markdown-%s-%t", route, enabled)
				secondLabel := fmt.Sprintf("shorthand-second-%s-%t", route, enabled)
				inlineCases := []struct {
					source  string
					content string
					mark    string
				}{
					{"**asterisk-strong**", "asterisk-strong", "strong"},
					{"*asterisk-emphasis*", "asterisk-emphasis", "em"},
					{"__underscore-strong__", "underscore-strong", "strong"},
					{"_underscore-emphasis_", "underscore-emphasis", "em"},
					{"^superscript^", "superscript", "sup"},
					{"~subscript~", "subscript", "sub"},
					{"测试#" + label + "#", label, "tag"},
					{"$x+1$", "x+1", "inline-math"},
					{"~~strikethrough~~", "strikethrough", "s"},
					{"～～fullwidth-strikethrough～～", "fullwidth-strikethrough", "s"},
					{"==highlight==", "highlight", "mark"},
				}
				parts := []string{"entry-first"}
				for _, inline := range inlineCases {
					parts = append(parts, inline.source)
				}
				parts = append(parts,
					"【】 fullwidth-open", "【X】 fullwidth-done", "【/】 fullwidth-progress",
					"···text\nmiddle-dot-body\n···",
					"- [x] ascii-task", "[] bare-ascii-task", "¥¥\nyen-body\n¥¥",
					"```text\nfirst-tail\n【X】 inside-code\n···not-a-fence")
				contents := []string{strings.Join(parts, "\n\n")}
				createdTimes := []time.Time{created}
				if "separate" != route {
					contents = append(contents, "entry-second\n\n测试#"+secondLabel+"#\n\n**second-strong**")
					createdTimes = append(createdTimes, secondCreated)
				}

				hPath := "/Markdown-" + label
				oldIDs := map[string]bool{}
				switch route {
				case "separate":
					Conf.FileTree.ShorthandSavePath = ""
					hPath = "/" + created.Format("2006-01-02 15:04:05")
				case "merged":
					Conf.FileTree.ShorthandSavePath = hPath
				case "append":
					hPath = "/Source"
					Conf.FileTree.ShorthandSavePath = hPath
					bt := treenode.GetBlockTreeRootByHPath(fixture.box.ID, hPath)
					if nil == bt {
						t.Fatal("existing shorthand document fixture missing")
					}
					before, err := loadTreeByBlockTree(bt)
					if nil != err {
						t.Fatal(err)
					}
					ast.Walk(before.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
						if entering && "" != n.ID {
							oldIDs[n.ID] = true
						}
						return ast.WalkContinue
					})
				}

				var sourcePaths []string
				for i, content := range contents {
					p := filepath.Join(shorthandsDir, strconv.FormatInt(createdTimes[i].UnixMilli(), 10)+".md")
					if err := os.WriteFile(p, []byte(content), 0644); nil != err {
						t.Fatal(err)
					}
					sourcePaths = append(sourcePaths, p)
				}
				retIDs, err := MoveLocalShorthands(fixture.box.ID)
				if nil != err {
					t.Fatal(err)
				}
				sql.FlushQueue()
				bt := treenode.GetBlockTreeRootByHPath(fixture.box.ID, hPath)
				if nil == bt {
					t.Fatal("shorthand document missing")
				}
				if "append" == route {
					if 0 != len(retIDs) || bt.ID != fixture.sourceID {
						t.Fatalf("append created a new document: ids=%v, root=%s", retIDs, bt.ID)
					}
				} else if 1 != len(retIDs) || retIDs[0] != bt.ID || !strings.HasPrefix(bt.ID, created.Format("20060102150405")) {
					t.Fatalf("unexpected new document ID or creation time: ids=%v, root=%s", retIDs, bt.ID)
				}

				// 清除缓存后重新加载，校验实际落盘的结构、索引和各条速记的时间。
				cache.RemoveTreeDataInBox(bt.ID, bt.BoxID)
				persisted, err := loadTreeByBlockTree(bt)
				if nil != err {
					t.Fatal(err)
				}
				if "append" != route && (persisted.Root.IALAttr("id") != bt.ID || persisted.Root.IALAttr("updated") != created.Format("20060102150405")) {
					t.Errorf("new document attributes do not preserve the earliest shorthand time: %v", persisted.Root.KramdownIAL)
				}
				assertShorthandMarkdownBlockTimes(t, persisted.Root, createdTimes, oldIDs)
				firstNodes := shorthandMarkdownNodesAtTime(persisted.Root, created)
				for _, inline := range inlineCases {
					got := shorthandMarkdownHasMark(firstNodes, inline.content, inline.mark)
					if got != enabled {
						t.Errorf("%q parsed as %s: got %t, want %t", inline.source, inline.mark, got, enabled)
					}
					if !enabled && !strings.Contains(shorthandMarkdownText(firstNodes), inline.source) {
						t.Errorf("disabled syntax was not preserved: %q", inline.source)
					}
				}
				for _, task := range []struct {
					label  string
					source string
					marker string
				}{
					{"fullwidth-open", "【】 fullwidth-open", " "},
					{"fullwidth-done", "【X】 fullwidth-done", "X"},
					{"fullwidth-progress", "【/】 fullwidth-progress", "/"},
				} {
					marker, found := shorthandMarkdownTaskMarker(firstNodes, task.label)
					if found != enabled || (enabled && marker != task.marker) {
						t.Errorf("%q task marker: got %q (%t), want %q (%t)", task.source, marker, found, task.marker, enabled)
					}
					if !enabled && !strings.Contains(shorthandMarkdownText(firstNodes), task.source) {
						t.Errorf("disabled fullwidth task was not preserved: %q", task.source)
					}
				}
				if marker, found := shorthandMarkdownTaskMarker(firstNodes, "ascii-task"); !found || "X" != marker {
					t.Errorf("standard task syntax changed: marker=%q, found=%t", marker, found)
				}
				if got := shorthandMarkdownCodeContains(firstNodes, "middle-dot-body"); got != enabled {
					t.Errorf("middle-dot code block: got %t, want %t", got, enabled)
				}
				if !enabled && !strings.Contains(shorthandMarkdownText(firstNodes), "···text") {
					t.Error("disabled middle-dot fence was not preserved")
				}
				if !shorthandMarkdownCodeContains(firstNodes, "first-tail\n【X】 inside-code\n···not-a-fence") {
					t.Error("standard code block content was changed by shorthand syntax normalization")
				}
				for _, literal := range []string{"[] bare-ascii-task", "¥¥\nyen-body\n¥¥"} {
					if !strings.Contains(shorthandMarkdownText(firstNodes), literal) {
						t.Errorf("unrelated syntax was changed: %q", literal)
					}
				}
				assertShorthandMarkdownTagIndex(t, label, bt.ID, created, enabled)
				if "separate" != route {
					secondNodes := shorthandMarkdownNodesAtTime(persisted.Root, secondCreated)
					if !strings.Contains(shorthandMarkdownText(secondNodes), "entry-second") || shorthandMarkdownCodeContains(firstNodes, "entry-second") {
						t.Fatal("unclosed code block consumed the next shorthand")
					}
					if shorthandMarkdownHasMark(secondNodes, "second-strong", "strong") != enabled {
						t.Error("second shorthand did not honor the inline settings")
					}
					assertShorthandMarkdownTagIndex(t, secondLabel, bt.ID, secondCreated, enabled)
				}
				for _, p := range sourcePaths {
					if _, err := os.Stat(p); !os.IsNotExist(err) {
						t.Errorf("consumed shorthand remains: %s (%v)", p, err)
					}
				}
			})
		}
	}
}

func setupShorthandMarkdownTest(t *testing.T) (*fileOperationTestFixture, string) {
	t.Helper()
	originalMarkdown := util.MarkdownSettings
	originalPaths := map[*string]string{
		&util.TempDir: util.TempDir, &util.QueueDir: util.QueueDir, &util.ConfDir: util.ConfDir,
		&util.ShortcutsPath: util.ShortcutsPath, &util.DBPath: util.DBPath,
		&util.HistoryDBPath: util.HistoryDBPath, &util.AssetContentDBPath: util.AssetContentDBPath,
		&util.WorkingDir: util.WorkingDir,
	}
	t.Cleanup(func() {
		util.MarkdownSettings = originalMarkdown
		for target, original := range originalPaths {
			*target = original
		}
	})
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
	Conf.Editor = conf.NewEditor()
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
	return fixture, shorthandsDir
}

func shorthandMarkdownTestSettings(enabled bool) *util.Markdown {
	return &util.Markdown{
		InlineAsterisk: enabled, InlineUnderscore: enabled, InlineSup: enabled, InlineSub: enabled,
		InlineTag: enabled, InlineMath: enabled, InlineStrikethrough: enabled,
		InlineFullWidthStrikethrough: enabled, InlineMark: enabled,
		BlockFullWidthTaskList: new(enabled), CodeBlockMiddleDot: new(enabled),
	}
}

func assertShorthandMarkdownBlockTimes(t *testing.T, root *ast.Node, createdTimes []time.Time, oldIDs map[string]bool) {
	t.Helper()
	prefixes := map[string]int{}
	order := map[string]int{}
	for i, created := range createdTimes {
		prefix := created.Format("20060102150405")
		prefixes[prefix] = 0
		order[prefix] = i
	}
	seenIDs := map[string]bool{}
	lastOrder := -1
	ast.Walk(root, func(n *ast.Node, entering bool) ast.WalkStatus {
		if entering && ast.NodeTag == n.Type {
			t.Error("persisted shorthand contains an unnormalized tag")
		}
		if !entering || !n.IsBlock() || ast.NodeKramdownBlockIAL == n.Type {
			return ast.WalkContinue
		}
		if seenIDs[n.ID] {
			t.Errorf("duplicate block ID: %s", n.ID)
		}
		seenIDs[n.ID] = true
		if oldIDs[n.ID] || ast.NodeDocument == n.Type {
			return ast.WalkContinue
		}
		if len(n.ID) < 14 {
			t.Fatalf("imported block has no timestamp: %s (%s)", n.ID, n.Type)
		}
		prefix := n.ID[:14]
		if _, ok := prefixes[prefix]; !ok {
			t.Errorf("imported block has an unexpected creation time: %s (%s)", n.ID, n.Type)
		} else {
			prefixes[prefix]++
			if order[prefix] < lastOrder {
				t.Errorf("shorthand blocks were persisted out of order: %s", n.ID)
			}
			lastOrder = order[prefix]
		}
		if n.IALAttr("id") != n.ID || n.IALAttr("updated") != prefix {
			t.Errorf("imported block attributes do not preserve its timestamp: %s, %v", n.ID, n.KramdownIAL)
		}
		return ast.WalkContinue
	})
	for id := range oldIDs {
		if !seenIDs[id] {
			t.Errorf("existing block was removed: %s", id)
		}
	}
	for prefix, count := range prefixes {
		if 0 == count {
			t.Errorf("no persisted blocks retain shorthand timestamp %s", prefix)
		}
	}
}

func shorthandMarkdownNodesAtTime(root *ast.Node, created time.Time) (ret []*ast.Node) {
	prefix := created.Format("20060102150405")
	ast.Walk(root, func(n *ast.Node, entering bool) ast.WalkStatus {
		if entering && n != root && n.IsBlock() && strings.HasPrefix(n.ID, prefix) {
			ret = append(ret, n)
			return ast.WalkSkipChildren
		}
		return ast.WalkContinue
	})
	return
}

func shorthandMarkdownText(nodes []*ast.Node) string {
	var parts []string
	for _, n := range nodes {
		var text strings.Builder
		ast.Walk(n, func(n *ast.Node, entering bool) ast.WalkStatus {
			if entering {
				switch n.Type {
				case ast.NodeText:
					text.Write(n.Tokens)
				case ast.NodeTextMark:
					text.WriteString(n.TextMarkTextContent)
				case ast.NodeSoftBreak, ast.NodeHardBreak:
					text.WriteByte('\n')
				}
			}
			return ast.WalkContinue
		})
		parts = append(parts, text.String())
	}
	return strings.Join(parts, "\n\n")
}

func shorthandMarkdownHasMark(nodes []*ast.Node, content, typ string) (ret bool) {
	for _, n := range nodes {
		ast.Walk(n, func(n *ast.Node, entering bool) ast.WalkStatus {
			if entering && ast.NodeTextMark == n.Type && n.IsTextMarkType(typ) &&
				(content == n.TextMarkTextContent || ("inline-math" == typ && content == n.TextMarkInlineMathContent)) {
				ret = true
			}
			return ast.WalkContinue
		})
	}
	return
}

func shorthandMarkdownTaskMarker(nodes []*ast.Node, label string) (marker string, found bool) {
	for _, n := range nodes {
		ast.Walk(n, func(n *ast.Node, entering bool) ast.WalkStatus {
			if entering && ast.NodeListItem == n.Type && strings.TrimSpace(n.Text()) == label {
				task := n.ChildByType(ast.NodeTaskListItemMarker)
				if nil == task && nil != n.ChildByType(ast.NodeParagraph) {
					task = n.ChildByType(ast.NodeParagraph).ChildByType(ast.NodeTaskListItemMarker)
				}
				if nil != task {
					marker, found = task.EffectiveTaskListItemMarker(), true
				}
			}
			return ast.WalkContinue
		})
	}
	return
}

func shorthandMarkdownCodeContains(nodes []*ast.Node, text string) (ret bool) {
	for _, n := range nodes {
		ast.Walk(n, func(n *ast.Node, entering bool) ast.WalkStatus {
			if entering && ast.NodeCodeBlockCode == n.Type && strings.Contains(n.TokensStr(), text) {
				ret = true
			}
			return ast.WalkContinue
		})
	}
	return
}

func assertShorthandMarkdownTagIndex(t *testing.T, label, rootID string, created time.Time, enabled bool) {
	t.Helper()
	spans := sql.QueryTagSpansByLabel(label)
	want := 0
	if enabled {
		want = 1
	}
	if len(spans) != want {
		t.Fatalf("tag %q index count: got %d, want %d", label, len(spans), want)
	}
	if enabled && (spans[0].RootID != rootID || !strings.HasPrefix(spans[0].BlockID, created.Format("20060102150405"))) {
		t.Errorf("tag %q index points to the wrong shorthand: %+v", label, spans[0])
	}
}
