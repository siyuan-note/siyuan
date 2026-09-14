package model

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/88250/lute/render"
	"github.com/siyuan-note/dejavu"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

const unavailableRelinkViewID = "20260914060000-missing"

func assetRelinkUnavailableTree(t *testing.T) (*parse.Tree, []byte) {
	t.Helper()
	const box = "20260914060001-closed0"
	writeAssetRelinkTestFile(t, box+"/.siyuan/conf.json", []byte(`{"name":"Closed notebook","closed":true}`))
	tree := treenode.NewTree(box, "/20260914060002-orphan0.sy", "/Orphan", "Orphan")
	for i, id := range []string{unavailableRelinkViewID, unavailableRelinkViewID, "../invalid"} {
		node := &ast.Node{Type: ast.NodeAttributeView, ID: []string{"20260914060003-orphan1", "20260914060004-orphan2", "20260914060005-orphan3"}[i], AttributeViewID: id}
		tree.Root.AppendChild(node)
	}
	l := util.NewLute()
	data := render.NewJSONRenderer(tree, l.RenderOptions, l.ParseOptions).Render()
	writeAssetRelinkTestFile(t, box+tree.Path, data)
	t.Cleanup(func() { forgetRuntimeNormalBox(box) })
	return tree, data
}

func checkAssetRelinkUnavailable(t *testing.T, result apicontract.AssetReferencesData, tree *parse.Tree) {
	t.Helper()
	if len(result.UnavailableAttributeViews) != 3 {
		t.Fatalf("missing warning locations: %+v", result)
	}
	for i, warning := range result.UnavailableAttributeViews {
		reason, id := "missing_definition", unavailableRelinkViewID
		if i == 2 {
			reason, id = "invalid_id", "../invalid"
		}
		if warning.AvID != id || warning.Reason != reason || warning.Notebook != tree.Box || warning.NotebookName != "Closed notebook" || warning.Path != tree.Path || warning.HPath != "/Orphan" || warning.RootID != tree.Root.ID || warning.BlockID == "" {
			t.Fatalf("incorrect warning location: %+v", warning)
		}
	}
}

func TestAssetRelinkUnavailableQueries(t *testing.T) {
	setupAssetRelinkTest(t)
	assetRelinkTestTree(t)
	orphan, original := assetRelinkUnavailableTree(t)
	for _, call := range []func() (apicontract.AssetReferencesData, error){
		func() (apicontract.AssetReferencesData, error) { return FindAssetReferences("assets/a.png") },
		func() (apicontract.AssetReferencesData, error) {
			return RelinkAsset("assets/a.png", "assets/b.webp", true)
		},
		func() (apicontract.AssetReferencesData, error) {
			return FindAssetReferencesBatch(context.Background(), []string{"assets/a.png"})
		},
		func() (apicontract.AssetReferencesData, error) {
			return RelinkAssets(context.Background(), []apicontract.AssetRelinkMapping{{OldPath: "assets/a.png", NewPath: "assets/b.webp"}}, true)
		},
	} {
		result, err := call()
		if err != nil || len(result.References) != 1 || result.Updated != 0 || result.HistoryPath != "" {
			t.Fatalf("unrelated missing definition blocked query: %+v %v", result, err)
		}
		checkAssetRelinkUnavailable(t, result, orphan)
	}
	current, _ := os.ReadFile(filepath.Join(util.DataDir, orphan.Box, orphan.Path))
	if !bytes.Equal(current, original) {
		t.Fatal("query repaired or removed orphan nodes")
	}
	if _, err := os.Stat(util.HistoryDir); !os.IsNotExist(err) {
		t.Fatal("query created history")
	}
	if dejavu.IsAssetDownloadPath("/storage/av/" + unavailableRelinkViewID + ".json") {
		t.Fatal("attribute view definitions now require deferred-download handling")
	}
}

func TestAssetRelinkUnavailableSnapshot(t *testing.T) {
	setupAssetRelinkTest(t)
	assetRelinkTestTree(t)
	assetRelinkUnavailableTree(t)
	plan, _ := newAssetRelinkPlan(context.Background(), []apicontract.AssetRelinkMapping{{OldPath: "assets/a.png", NewPath: "assets/b.webp"}}, false, false, true)
	if err := plan.scan(); err != nil {
		t.Fatal(err)
	}
	writeAssetRelinkTestFile(t, "storage/av/"+unavailableRelinkViewID+".json", []byte(`{}`))
	if err := plan.apply(); err == nil {
		t.Fatal("definition restored after scan was silently omitted")
	}
}

func TestAssetRelinkUnavailableDoesNotHideDamage(t *testing.T) {
	for _, kind := range []string{"corrupt", "directory"} {
		t.Run(kind, func(t *testing.T) {
			setupAssetRelinkTest(t)
			assetRelinkTestTree(t)
			assetRelinkUnavailableTree(t)
			rel := "storage/av/" + unavailableRelinkViewID + ".json"
			if kind == "corrupt" {
				writeAssetRelinkTestFile(t, rel, []byte(`{"invalid"`))
			} else if err := os.MkdirAll(filepath.Join(util.DataDir, rel), 0755); err != nil {
				t.Fatal(err)
			}
			if _, err := FindAssetReferences("assets/a.png"); err == nil {
				t.Fatal("damaged definition treated as missing")
			}
		})
	}
}
