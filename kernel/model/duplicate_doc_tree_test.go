package model

import (
	"bytes"
	"errors"
	"os"
	"path"
	"path/filepath"
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func duplicateDocTreeFixture(t *testing.T) (*fileOperationTestFixture, []*parse.Tree) {
	t.Helper()
	f := setupFileOperationTest(t)
	root, err := filesys.LoadTree(f.box.ID, f.sourcePath, util.NewLute())
	if err != nil {
		t.Fatal(err)
	}
	child := treenode.NewTree(f.box.ID, "/"+root.ID+"/20260919010000-child01.sy", "/Source/Child", "Child")
	sibling := treenode.NewTree(f.box.ID, "/"+root.ID+"/20260919010001-child02.sy", "/Source/Sibling", "Sibling")
	grandchild := treenode.NewTree(f.box.ID, strings.TrimSuffix(child.Path, ".sy")+"/20260919010002-grand01.sy", "/Source/Child/Grandchild", "Grandchild")
	trees := []*parse.Tree{root, child, sibling, grandchild}
	for i, tree := range trees {
		paragraph := tree.Root.FirstChild
		paragraph.SetIALAttr("custom-example", "kept")
		paragraph.SetIALAttr(av.NodeAttrNameAvs, "database-binding")
		paragraph.SetIALAttr(NodeAttrRiffDecks, "flashcards")
		for _, id := range []string{trees[(i+1)%len(trees)].Root.FirstChild.ID, root.ID, f.targetID, "20260919010009-unknown"} {
			paragraph.AppendChild(&ast.Node{Type: ast.NodeTextMark, TextMarkType: "block-ref", TextMarkBlockRefID: id,
				TextMarkBlockRefSubtype: "s", TextMarkTextContent: "reference"})
		}
		paragraph.AppendChild(&ast.Node{Type: ast.NodeTextMark, TextMarkType: "a",
			TextMarkAHref: "siyuan://blocks/" + child.ID + "?focus=1#anchor", TextMarkTextContent: "link"})
		paragraph.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte(child.ID)})
		if _, err = filesys.WriteTree(tree); err != nil {
			t.Fatal(err)
		}
		treenode.UpsertBlockTree(tree)
		t.Cleanup(func() {
			cache.RemoveTreeDataInBox(tree.ID, tree.Box)
			cache.RemoveDocIALInBox(tree.Path, tree.Box)
		})
	}
	root.Root.SetIALAttr(DocSortModeAttr, "6")
	if _, err = filesys.WriteTree(root); err != nil {
		t.Fatal(err)
	}
	if err = writeSortConfMap(filepath.Join(util.DataDir, f.box.ID, ".siyuan", "sort.json"),
		map[string]int{root.ID: 1, f.targetID: 2, child.ID: 20, sibling.ID: 10}); err != nil {
		t.Fatal(err)
	}
	return f, trees
}

func TestDuplicateDocTreeReferencesAndOrder(t *testing.T) {
	f, originals := duplicateDocTreeFixture(t)
	before := map[string][]byte{}
	for _, tree := range originals {
		before[tree.Path], _ = os.ReadFile(filepath.Join(util.DataDir, tree.Box, tree.Path))
	}
	plan, err := prepareDuplicateDocTree(f.box.ID, f.sourcePath)
	if err != nil {
		t.Fatal(err)
	}
	if len(plan.trees) != 4 {
		t.Fatalf("descendants missing: %d", len(plan.trees))
	}
	root := plan.trees[0]
	if root.Root.IALAttr(DocSortModeAttr) != "6" || !strings.Contains(root.Root.IALAttr("title"), "(Duplicated ") {
		t.Fatalf("root metadata changed: %v", root.Root.KramdownIAL)
	}
	if err = plan.commit(filesys.WriteTree); err != nil {
		t.Fatal(err)
	}
	for _, original := range originals {
		current, _ := os.ReadFile(filepath.Join(util.DataDir, original.Box, original.Path))
		if !bytes.Equal(current, before[original.Path]) {
			t.Fatal("source was modified")
		}
		var copied *parse.Tree
		for _, tree := range plan.trees {
			if tree.ID == plan.ids[original.ID] {
				copied = tree
			}
		}
		if copied == nil {
			t.Fatal("missing mapped document")
		}
		loaded, _, loadErr := filesys.ReadTreeSnapshot(copied.Box, copied.Path)
		if loadErr != nil {
			t.Fatal(loadErr)
		}
		if copied != root && (loaded.Root.IALAttr("title") != original.Root.IALAttr("title") || !strings.HasPrefix(loaded.HPath, root.HPath+"/")) {
			t.Fatalf("child title or hierarchy changed: %s", loaded.HPath)
		}
		paragraph := loaded.Root.FirstChild
		if paragraph.IALAttr("custom-example") != "kept" || paragraph.IALAttr(av.NodeAttrNameAvs) != "" || paragraph.IALAttr(NodeAttrRiffDecks) != "" {
			t.Fatal("copied block attributes are incorrect")
		}
		refs := paragraph.ChildrenByType(ast.NodeTextMark)
		for i, oldRef := range original.Root.FirstChild.ChildrenByType(ast.NodeTextMark)[:4] {
			expected := oldRef.TextMarkBlockRefID
			if mapped := plan.ids[expected]; mapped != "" {
				expected = mapped
			}
			if refs[i].TextMarkBlockRefID != expected {
				t.Fatalf("reference was lost or not remapped: %s != %s", refs[i].TextMarkBlockRefID, expected)
			}
		}
		if refs[4].TextMarkAHref != "siyuan://blocks/"+plan.ids[originals[1].ID]+"?focus=1#anchor" {
			t.Fatal("block hyperlink lost its target or parameters")
		}
		if paragraph.LastChild.TokensStr() != originals[1].ID {
			t.Fatal("literal text was rewritten")
		}
	}
	sorts, _ := readSortConfMap(filepath.Join(util.DataDir, f.box.ID, ".siyuan", "sort.json"))
	if !(sorts[f.sourceID] < sorts[root.ID] && sorts[root.ID] < sorts[f.targetID]) {
		t.Fatal("root copy was not inserted after source")
	}
	if sorts[plan.ids[originals[2].ID]] >= sorts[plan.ids[originals[1].ID]] {
		t.Fatal("child custom order changed")
	}
}

func TestDuplicateDocTreeRichTableReferences(t *testing.T) {
	oldID, newID := "20260919010005-source1", "20260919010006-target1"
	tree := parse.Parse("", []byte("| Header |\n| --- |\n| Existing |\n"), util.NewLute().ParseOptions)
	cell := tree.Root.FirstChild.LastChild.FirstChild
	cell.TableCellRich = &ast.TableCellRich{Spec: 1, Format: "kramdown",
		Content: "((" + oldID + " 'reference')) [link](siyuan://blocks/" + oldID + ") `" + oldID + "` ![image](assets/original.png)"}
	if err := treenode.RefreshTableCellRichProjection(tree.Root); err != nil {
		t.Fatal(err)
	}
	remapDuplicateDocTreeReferences(tree.Root, map[string]string{oldID: newID})
	if err := treenode.SyncTableCellRichInlineChanges(tree.Root); err != nil {
		t.Fatal(err)
	}
	for _, expected := range []string{`data-id="` + newID + `"`, "siyuan://blocks/" + newID, `data-type="code">` + oldID + `</span>`, "assets/original.png"} {
		if !strings.Contains(cell.TableCellRich.Content, expected) {
			t.Fatalf("rich table reference or literal changed incorrectly: %s", cell.TableCellRich.Content)
		}
	}
}

func TestDuplicateDocTreeRollback(t *testing.T) {
	for _, failure := range []string{"write", "source-change", "mirror"} {
		t.Run(failure, func(t *testing.T) {
			f, _ := duplicateDocTreeFixture(t)
			plan, err := prepareDuplicateDocTree(f.box.ID, f.sourcePath)
			if err != nil {
				t.Fatal(err)
			}
			sortPath := filepath.Join(util.DataDir, f.box.ID, ".siyuan", "sort.json")
			beforeSort, _ := os.ReadFile(sortPath)
			if failure == "mirror" {
				plan.avNodes = []*ast.Node{{Type: ast.NodeAttributeView, ID: ast.NewNodeID(), AttributeViewID: "20260919010003-missing"}}
			}
			writes := 0
			err = plan.commit(func(tree *parse.Tree) (uint64, error) {
				writes++
				size, writeErr := filesys.WriteTree(tree)
				if writes == 2 && failure == "write" {
					return size, errors.New("injected write failure after file creation")
				}
				if writes == 2 && failure == "source-change" {
					abs := filepath.Join(util.DataDir, f.box.ID, f.sourcePath)
					data, _ := os.ReadFile(abs)
					if writeErr = os.WriteFile(abs, append(data, '\n'), 0644); writeErr != nil {
						t.Fatal(writeErr)
					}
				}
				return size, writeErr
			})
			if err == nil {
				t.Fatal("failed copy reported success")
			}
			for _, tree := range plan.trees {
				if _, statErr := os.Stat(filepath.Join(util.DataDir, tree.Box, tree.Path)); !os.IsNotExist(statErr) {
					t.Fatalf("failed copy left a document: %s", tree.Path)
				}
				if _, cached := cache.GetTreeDataInBox(tree.ID, tree.Box); cached || treenode.GetBlockTree(tree.ID) != nil {
					t.Fatal("failed copy left cached or indexed data")
				}
			}
			afterSort, _ := os.ReadFile(sortPath)
			if !bytes.Equal(beforeSort, afterSort) {
				t.Fatal("failed copy changed sorting")
			}
		})
	}
}

func TestDuplicateDocTreeRejectsInvalidSources(t *testing.T) {
	for _, failure := range []string{"corrupt", "future-spec", "invalid-root", "changed-set", "orphan"} {
		t.Run(failure, func(t *testing.T) {
			f, trees := duplicateDocTreeFixture(t)
			plan, err := prepareDuplicateDocTree(f.box.ID, f.sourcePath)
			if err != nil {
				t.Fatal(err)
			}
			abs := filepath.Join(util.DataDir, f.box.ID, trees[1].Path)
			switch failure {
			case "corrupt":
				err = os.WriteFile(abs, []byte(`{"broken":`), 0644)
			case "future-spec":
				err = os.WriteFile(abs, []byte(`{"Spec":"999","Type":"NodeDocument"}`), 0644)
			case "invalid-root":
				err = os.WriteFile(abs, []byte(`{"ID":"`+trees[1].ID+`","Type":"NodeParagraph","Properties":{"id":"`+trees[1].ID+`"}}`), 0644)
			case "orphan":
				err = os.Remove(abs)
			case "changed-set":
				tree := treenode.NewTree(f.box.ID, path.Join(strings.TrimSuffix(f.sourcePath, ".sy"), ast.NewNodeID()+".sy"), "/Source/Extra", "Extra")
				_, err = filesys.WriteTree(tree)
			}
			if err != nil {
				t.Fatal(err)
			}
			if failure != "changed-set" {
				if _, err = prepareDuplicateDocTree(f.box.ID, f.sourcePath); err == nil {
					t.Fatal("invalid source accepted")
				}
			}
			if err = plan.commit(filesys.WriteTree); err == nil {
				t.Fatal("stale source accepted")
			}
		})
	}
}

func TestDuplicateDocTreeDatabaseMirrors(t *testing.T) {
	f := setupFileOperationTest(t)
	view := addTemplateAttributeViewTestFixture(t, f, "20260919010004-mirror1")
	before, err := av.ReadAttributeViewData(view.attrView.ID)
	if err != nil {
		t.Fatal(err)
	}
	plan, err := prepareDuplicateDocTree(f.box.ID, f.sourcePath)
	if err != nil {
		t.Fatal(err)
	}
	if err = plan.commit(filesys.WriteTree); err != nil {
		t.Fatal(err)
	}
	after, err := av.ReadAttributeViewData(view.attrView.ID)
	if err != nil || !bytes.Equal(before, after) {
		t.Fatal("mirror copy changed database definition or row bindings")
	}
	rels := av.GetBlockRels()[view.attrView.ID]
	for _, node := range plan.avNodes {
		if node.AttributeViewID != view.attrView.ID || !strings.Contains(strings.Join(rels, ","), node.ID) {
			t.Fatal("mirror relation was not registered")
		}
	}
}

func TestDuplicateDocTreeEmbeddedReferences(t *testing.T) {
	oldID, newID := "20260919010005-source1", "20260919010006-target1"
	root := &ast.Node{Type: ast.NodeDocument}
	embed := &ast.Node{Type: ast.NodeBlockQueryEmbedScript, Tokens: []byte("select * from blocks where id='" + oldID + "'")}
	root.AppendChild(embed)
	legacy := &ast.Node{Type: ast.NodeBlockRef}
	legacy.AppendChild(&ast.Node{Type: ast.NodeBlockRefID, Tokens: []byte(oldID)})
	root.AppendChild(legacy)
	link := &ast.Node{Type: ast.NodeLinkDest, Tokens: []byte("siyuan://blocks/" + oldID + "?focus=1")}
	root.AppendChild(link)
	tabs := &ast.Node{Type: ast.NodeTabs}
	tabs.SetIALAttr("tabs-active-id", oldID)
	item := &ast.Node{Type: ast.NodeTabItem, ID: newID, TabItemTitle: "((" + oldID + " 'title'))"}
	item.AppendChild(treenode.NewParagraph(""))
	tabs.AppendChild(item)
	root.AppendChild(tabs)
	remapDuplicateDocTreeReferences(root, map[string]string{oldID: newID})
	if !strings.Contains(embed.TokensStr(), newID) || legacy.FirstChild.TokensStr() != newID ||
		link.TokensStr() != "siyuan://blocks/"+newID+"?focus=1" || tabs.IALAttr("tabs-active-id") != newID ||
		!strings.Contains(item.TabItemTitle, newID) {
		t.Fatal("embedded, legacy, link, or tab reference was not remapped")
	}
}
