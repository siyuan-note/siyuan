// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package filesys

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/88250/lute/render"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestWalkTreeSnapshotsPreservesSourcesAndAncestorScope(t *testing.T) {
	box, parent, childPath, _ := setupStalePathTest(t)
	previousConf := util.ConfDir
	util.ConfDir = t.TempDir()
	t.Cleanup(func() { util.ConfDir = previousConf })
	write := func(p, title string) []byte {
		t.Helper()
		tree := treenode.NewTree(box, p, "", title)
		tree.Root.FirstChild.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("body remains complete")})
		engine := util.NewLute()
		data := render.NewJSONRenderer(tree, engine.RenderOptions, engine.ParseOptions).Render()
		writeStalePathFixture(t, box, p, data)
		return data
	}
	parentPath := "/" + parent + ".sy"
	secondPath := "/" + parent + "/20261023000003-child02.sy"
	paths := []string{childPath, secondPath}
	original := map[string][]byte{}
	for _, p := range paths {
		original[p] = write(p, "Child &amp;")
	}
	for _, title := range []string{"Parent &amp;", "", "Changed parent"} {
		write(parentPath, title)
		visited := 0
		err := WalkTreeSnapshots(box, paths, func(tree *parse.Tree) error {
			visited++
			expected := title
			if expected == "" {
				expected = "Untitled"
			}
			if tree.HPath != "/"+expected+"/Child &amp;" || tree.ID != util.GetTreeID(tree.Path) ||
				tree.Root.FirstChild.FirstChild == nil || string(tree.Root.FirstChild.FirstChild.Tokens) != "body remains complete" {
				t.Fatalf("snapshot lost literal title, identity or content: %+v", tree)
			}
			return nil
		})
		if err != nil || visited != len(paths) {
			t.Fatalf("ancestor state leaked across operations: visits=%d, err=%v", visited, err)
		}
	}
	stop := errors.New("stop before later source")
	visited := 0
	if err := WalkTreeSnapshots(box, paths, func(*parse.Tree) error { visited++; return stop }); !errors.Is(err, stop) || visited != 1 {
		t.Fatal("visitor failure did not stop the batch", visited, err)
	}
	if err := os.Remove(filepath.Join(util.DataDir, box, parentPath)); err != nil {
		t.Fatal(err)
	}
	if err := WalkTreeSnapshots(box, paths, func(*parse.Tree) error {
		t.Fatal("missing parent reached the visitor")
		return nil
	}); !os.IsNotExist(err) {
		t.Fatal("batch reused a parent from another operation", err)
	}
	for p, before := range original {
		after, err := os.ReadFile(filepath.Join(util.DataDir, box, p))
		if err != nil || !bytes.Equal(before, after) {
			t.Fatal("read-only batch changed a source", err)
		}
	}
}
