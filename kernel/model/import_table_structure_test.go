package model

import (
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestImportMarkdownTableStructure(t *testing.T) {
	for _, source := range []string{
		"- [ ] task<br />- [x] done",
		"<ul><li>outer<ul><li>nested</li></ul></li></ul>",
		"<p>first</p><pre><code class=\"language-go\">a &#124; b&#10;c&#10;</code></pre>",
	} {
		t.Run(source, func(t *testing.T) {
			tree, _, _, _ := parseStdMd([]byte("| head |\n| --- |\n| "+source+" |"), true)
			found := false
			ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
				if entering && n.TableCellRich != nil {
					found = true
					if _, err := parse.ParseTableCellRich(n.TableCellRich); err != nil {
						t.Fatal(err)
					}
					if strings.Contains(source, "language-go") && !strings.Contains(n.TableCellRich.Content, "a | b\nc\n") {
						t.Fatalf("code content changed: %s", n.TableCellRich.Content)
					}
				}
				return ast.WalkContinue
			})
			if !found {
				t.Fatal("rich table content was not restored")
			}
			if err := treenode.SyncTableCellRichInlineChanges(tree.Root); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestMarkdownImportRichTableWrite(t *testing.T) {
	setupMarkdownSpoolTest(t)
	originalDataDir, originalProvider := util.DataDir, filesys.DEKProvider
	originalAcquire, originalRelease := filesys.DEKLockAcquire, filesys.DEKLockRelease
	util.DataDir = t.TempDir()
	filesys.DEKProvider = func(string) ([]byte, error) { return nil, nil }
	filesys.DEKLockAcquire, filesys.DEKLockRelease = nil, nil
	t.Cleanup(func() {
		cache.ClearTreeCache()
		util.DataDir, filesys.DEKProvider = originalDataDir, originalProvider
		filesys.DEKLockAcquire, filesys.DEKLockRelease = originalAcquire, originalRelease
	})
	for _, staged := range []bool{false, true} {
		mode := "single"
		if staged {
			mode = "folder"
		}
		for _, source := range []string{
			"- [ ] 准备观察表<br />- [x] 带齐铅笔",
			"<ul><li>outer<ul><li>nested</li></ul></li></ul>",
			"<p>示例</p><pre><code class=\"language-go\">a &#124; b&#10;c&#10;</code></pre>",
		} {
			t.Run(mode+"/"+source, func(t *testing.T) {
				spool := &markdownImportSpool{searchLinks: map[string]string{}}
				if staged {
					var err error
					spool, err = newMarkdownImportSpool()
					if err != nil {
						t.Fatal(err)
					}
				}
				defer spool.close()
				tree := markdownSpoolFixture("| 准备 |\n| --- |\n| "+source+" |\n", "table", 1)
				cell := tree.Root.FirstChild.LastChild.FirstChild
				if cell.TableCellRich == nil {
					t.Fatal("rich table source missing")
				}
				original := cell.TableCellRich.Content
				if err := spool.add(tree); err != nil {
					t.Fatal(err)
				}
				if err := spool.finish(func(tree *parse.Tree) error {
					if _, err := filesys.WriteTree(tree); err != nil {
						return err
					}
					cache.ClearTreeCache()
					restored, err := filesys.LoadTree(tree.Box, tree.Path, util.NewLute())
					if err != nil {
						return err
					}
					cell := restored.Root.FirstChild.LastChild.FirstChild
					if cell.TableCellRich == nil || cell.TableCellRich.Content != original {
						t.Fatalf("rich table source changed after import and reload: %#v", cell.TableCellRich)
					}
					return nil
				}, func() {}); err != nil {
					t.Fatal(err)
				}
			})
		}
	}
}

func TestMarkdownImportRichTableConvertsLinksAndAssets(t *testing.T) {
	setupMarkdownSpoolTest(t)
	spool, err := newMarkdownImportSpool()
	if err != nil {
		t.Fatal(err)
	}
	defer spool.close()
	const targetID = "20261010000000-target1"
	spool.searchLinks["/target#"] = targetID
	tree := markdownSpoolFixture("| head |\n| --- |\n| - [ ] ![image](assets/old.png) [document](target.md) #tag<br />- [x] done |\n", "table", 1)
	ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
		if entering && n.Type == ast.NodeLinkDest && n.TokensStr() == "assets/old.png" {
			n.Tokens = []byte("assets/new.png")
		}
		return ast.WalkContinue
	})
	if err := spool.add(tree); err != nil {
		t.Fatal(err)
	}
	if err := spool.finish(func(tree *parse.Tree) error {
		if err := treenode.SyncTableCellRichInlineChanges(tree.Root); err != nil {
			return err
		}
		cell := tree.Root.FirstChild.LastChild.FirstChild
		fragment, err := parse.ParseTableCellRich(cell.TableCellRich)
		if err != nil {
			return err
		}
		asset, reference, tag, checked := false, false, false, false
		ast.Walk(fragment.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
			if entering {
				asset = asset || n.Type == ast.NodeLinkDest && n.TokensStr() == "assets/new.png"
				reference = reference || n.IsTextMarkType("block-ref") && n.TextMarkBlockRefID == targetID
				tag = tag || n.IsTextMarkType("tag") && n.TextMarkTextContent == "tag"
				checked = checked || n.Type == ast.NodeTaskListItemMarker && n.TaskListItemChecked
			}
			return ast.WalkContinue
		})
		if !asset || !reference || !tag || !checked {
			t.Fatalf("rich source conversion lost content: asset=%t reference=%t tag=%t checked=%t\n%s",
				asset, reference, tag, checked, cell.TableCellRich.Content)
		}
		return nil
	}, func() {}); err != nil {
		t.Fatal(err)
	}
}
