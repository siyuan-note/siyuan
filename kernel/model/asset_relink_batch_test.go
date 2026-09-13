package model

import (
	"bytes"
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/render"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAssetRelinkBatchPreflight(t *testing.T) {
	setupAssetRelinkTest(t)
	assetRelinkTestTree(t)
	mappings := []apicontract.AssetRelinkMapping{
		{OldPath: "assets/a.png", NewPath: "assets/b.webp"},
		{OldPath: "assets/missing.png", NewPath: "assets/missing.webp"},
	}
	result, err := RelinkAssets(context.Background(), mappings, true)
	if err != nil || len(result.Items) != 2 || !result.Items[0].OK || result.Items[1].OK || result.Items[1].Reason == "" {
		t.Fatalf("partial preview: %+v %v", result, err)
	}
	if len(result.Items[0].References) != 1 || result.Updated != 0 || result.HistoryPath != "" {
		t.Fatalf("preview changed data or lost attribution: %+v", result)
	}
	if _, err = RelinkAssets(context.Background(), mappings[1:], true); err == nil {
		t.Fatal("all failed batch succeeded")
	}
	for _, invalid := range [][]apicontract.AssetRelinkMapping{
		{},
		{{OldPath: "assets/a.png", NewPath: "assets/b.webp"}, {OldPath: "assets/%61.png", NewPath: "assets/c.webp"}},
		{{OldPath: "assets/a.png", NewPath: "assets/b.webp"}, {OldPath: "assets/b.webp", NewPath: "assets/c.webp"}},
		{{OldPath: "assets/a.png", NewPath: "assets/b.webp"}, {OldPath: "assets/b.webp", NewPath: "assets/a.png"}},
	} {
		if _, err = RelinkAssets(context.Background(), invalid, true); err == nil {
			t.Fatalf("invalid mappings accepted: %+v", invalid)
		}
	}
	query, err := FindAssetReferencesBatch(context.Background(), []string{"assets/a.png", "../outside"})
	if err != nil || len(query.Items) != 2 || !query.Items[0].OK || query.Items[1].OK {
		t.Fatalf("batch query: %+v %v", query, err)
	}
}

func TestAssetRelinkBatchCandidateEscapes(t *testing.T) {
	setupAssetRelinkTest(t)
	tree, _ := assetRelinkTestTree(t)
	l := util.NewLute()
	plain := treenode.NewTree(tree.Box, "/20260914040000-plain00.sy", "/Plain", "Plain")
	plain.Root.AppendChild(&ast.Node{Type: ast.NodeParagraph, ID: "20260914040001-plain01", Children: nil})
	writeAssetRelinkTestFile(t, plain.Box+plain.Path, render.NewJSONRenderer(plain, l.RenderOptions, l.ParseOptions).Render())
	planned, err := newAssetRelinkPlan(context.Background(), []apicontract.AssetRelinkMapping{{OldPath: "assets/a.png", NewPath: "assets/b.webp"}}, true, false, true)
	if err != nil {
		t.Fatal(err)
	}
	if err = planned.run(); err != nil {
		t.Fatal(err)
	}
	if planned.parsedDocuments != 1 {
		t.Fatalf("parsed %d documents instead of the one candidate", planned.parsedDocuments)
	}
	for _, fixture := range [][]byte{
		[]byte(`{"href":"assets/%61.png"}`),
		[]byte(`{"href":"assets/\u0061.png"}`),
		[]byte(`{"html":"assets/&#97;.png"}`),
		[]byte(`{"href":"assets/a.png"}`),
	} {
		if !planned.mayContainReferences(fixture) {
			t.Fatalf("escaped reference filtered out: %s", fixture)
		}
	}
	if planned.mayContainReferences([]byte(`{"text":"plain content"}`)) {
		t.Fatal("unrelated content accepted by prefilter")
	}
}

func TestAssetRelinkBatchScanAllowsEditingAndCancellation(t *testing.T) {
	setupAssetRelinkTest(t)
	tree, original := assetRelinkTestTree(t)
	plan, _ := newAssetRelinkPlan(context.Background(), []apicontract.AssetRelinkMapping{{OldPath: "assets/a.png", NewPath: "assets/b.webp"}}, true, false, true)
	checked := false
	plan.progress = func(string) {
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		if err := lockAssetRelink(ctx, &flushLock); err != nil {
			t.Fatalf("editing was blocked by scanning: %v", err)
		}
		flushLock.Unlock()
		checked = true
	}
	if err := plan.run(); err != nil || !checked {
		t.Fatalf("scan progress: %v %v", checked, err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancelled, _ := newAssetRelinkPlan(ctx, []apicontract.AssetRelinkMapping{{OldPath: "assets/a.png", NewPath: "assets/b.webp"}}, false, false, true)
	cancelled.progress = func(string) { cancel() }
	if err := cancelled.run(); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancellation ignored: %v", err)
	}
	current, _ := os.ReadFile(filepath.Join(util.DataDir, tree.Box, tree.Path))
	if !bytes.Equal(current, original) {
		t.Fatal("cancelled scan changed a source")
	}
	if _, err := os.Stat(util.HistoryDir); !os.IsNotExist(err) {
		t.Fatal("cancelled scan created history")
	}
}

func TestAssetRelinkBatchDetectsNewReferencesDuringScan(t *testing.T) {
	setupAssetRelinkTest(t)
	tree, original := assetRelinkTestTree(t)
	plan, _ := newAssetRelinkPlan(context.Background(), []apicontract.AssetRelinkMapping{{OldPath: "assets/a.png", NewPath: "assets/b.webp"}}, false, false, true)
	if err := plan.scan(); err != nil {
		t.Fatal(err)
	}
	writeAssetRelinkTestFile(t, tree.Box+"/20260914040002-added00.sy", original)
	if err := plan.apply(); err == nil {
		t.Fatal("new document was omitted from an all-reference replacement")
	}
	current, _ := os.ReadFile(filepath.Join(util.DataDir, tree.Box, tree.Path))
	if !bytes.Equal(current, original) {
		t.Fatal("stale snapshot changed data")
	}
}

func TestAssetRelinkBatchAnnotationTargetConflict(t *testing.T) {
	setupAssetRelinkTest(t)
	writeAssetRelinkTestFile(t, "assets/target.pdf", []byte("PDF"))
	var mappings []apicontract.AssetRelinkMapping
	for i, source := range []string{"assets/one.pdf", "assets/two.pdf", "assets/three.pdf"} {
		writeAssetRelinkTestFile(t, source, []byte("PDF"))
		annotation := []byte(`{"text":"first"}`)
		if i == 1 {
			annotation = []byte(`{"text":"second"}`)
		}
		writeAssetRelinkTestFile(t, source+".sya", annotation)
		mappings = append(mappings, apicontract.AssetRelinkMapping{OldPath: source, NewPath: "assets/target.pdf"})
	}
	result, err := RelinkAssets(context.Background(), mappings, true)
	if err == nil || len(result.Items) != 3 {
		t.Fatalf("conflicting annotations accepted: %+v %v", result, err)
	}
	for _, item := range result.Items {
		if item.OK || item.Reason != "annotation_target_conflict" {
			t.Fatalf("conflict did not cover every source: %+v", item)
		}
	}
	if _, err := os.Stat(filepath.Join(util.DataDir, "assets/target.pdf.sya")); !os.IsNotExist(err) {
		t.Fatal("conflicting annotation target was created")
	}
}
