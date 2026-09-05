package model

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/dataparser"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestTabsUserGuideExamplesRoundTrip(t *testing.T) {
	ids := map[string]bool{"20200825162036-4dx365o.sy": true, "20200924093441-ft2rhps.sy": true,
		"20211226121319-emrk2yy.sy": true, "20240530101000-3qhz7br.sy": true}
	l := util.NewLute()
	count := 0
	err := filepath.WalkDir("../../app/guide", func(path string, entry os.DirEntry, err error) error {
		if err != nil || entry.IsDir() || !ids[entry.Name()] {
			return err
		}
		count++
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		tree, err := dataparser.ParseJSONWithoutFix(data, l.ParseOptions)
		if err != nil {
			return err
		}
		if tree.Root.Spec != "3" {
			t.Fatalf("%s: tabs require spec 3", path)
		}
		ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
			if !entering || n.Type != ast.NodeTabs {
				return ast.WalkContinue
			}
			if err := treenode.ValidateBlockSubtree(n); err != nil {
				t.Fatal(err)
			}
			fragment := &parse.Tree{Root: n}
			dom := l.Tree2BlockDOM(fragment, l.RenderOptions, l.ParseOptions)
			spun := l.SpinBlockDOM(dom)
			for _, id := range n.BlockIDs() {
				if !strings.Contains(spun, id) {
					t.Fatalf("%s: lost block %s", path, id)
				}
			}
			return ast.WalkSkipChildren
		})
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if count != len(ids) {
		t.Fatalf("found %d guide examples", count)
	}
}
