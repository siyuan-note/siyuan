// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/88250/lute/render"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestMissingAssetsSourceFailures(t *testing.T) {
	want := errors.New("scan source unavailable")
	for _, source := range []string{"asset paths", "notebooks", "panic", "directory walk"} {
		t.Run(source, func(t *testing.T) {
			assetPaths := func() (map[string]string, error) {
				if source == "asset paths" {
					return nil, want
				}
				return map[string]string{}, nil
			}
			notebooks := func() ([]*Box, error) {
				switch source {
				case "notebooks":
					return nil, want
				case "panic":
					panic("scan panic")
				case "directory walk":
					return []*Box{{ID: filepath.Join(t.TempDir(), "missing")}}, nil
				}
				t.Fatal("asset path failure must stop notebook enumeration")
				return nil, nil
			}
			items, err := missingAssets(assetPaths, notebooks)
			if err == nil || len(items) != 0 {
				t.Fatalf("failed scan returned success: %+v, %v", items, err)
			}
			if (source == "asset paths" || source == "notebooks") && !errors.Is(err, want) {
				t.Fatalf("lost source error: %v", err)
			}
			if source == "panic" && !strings.Contains(err.Error(), "scan panic") {
				t.Fatalf("lost panic diagnostic: %v", err)
			}
		})
	}
}

func writeMissingAssetDocument(t *testing.T, boxID, filename string) {
	t.Helper()
	root := &ast.Node{Type: ast.NodeDocument, ID: "20260918000001-abcdefg", Spec: treenode.CurrentSpec}
	root.SetIALAttr("title-img", "background-image: url(assets/missing.png)")
	engine := util.NewLute()
	data := render.NewJSONRenderer(&parse.Tree{Root: root}, engine.RenderOptions, engine.ParseOptions).Render()
	if err := os.WriteFile(filename, data, 0644); err != nil {
		t.Fatal(err)
	}
	boxConf := conf.NewBoxConf()
	boxConf.Closed = false
	if err := (&Box{ID: boxID}).SaveConf(boxConf); err != nil {
		t.Fatal(err)
	}
}

func TestMissingAssetsCompleteScan(t *testing.T) {
	boxID, docPath := setupUnusedAssetWorkspace(t)
	writeMissingAssetDocument(t, boxID, docPath)
	items, err := MissingAssets()
	if err != nil || len(items) != 1 || items[0].Item != "assets/missing.png" ||
		len(items[0].BlockIDs) != 1 || items[0].BlockIDs[0] != "20260918000001-abcdefg" {
		t.Fatalf("missing asset scan: %+v, %v", items, err)
	}
	if err = os.WriteFile(filepath.Join(util.DataDir, "assets", "missing.png"), []byte("image"), 0644); err != nil {
		t.Fatal(err)
	}
	items, err = MissingAssets()
	if err != nil || items == nil || len(items) != 0 {
		t.Fatalf("complete scan must return an empty array: %+v, %v", items, err)
	}
}

func TestMissingAssetsSkipUnreadableDocument(t *testing.T) {
	for _, test := range []struct{ name, data string }{
		{"new spec", `{"Type":"NodeDocument","Spec":"99"}`},
		{"invalid spec", `{"Type":"NodeDocument","Spec":"invalid"}`},
		{"corrupt JSON", `{"Type":`},
	} {
		t.Run(test.name, func(t *testing.T) {
			boxID, docPath := setupUnusedAssetWorkspace(t)
			writeMissingAssetDocument(t, boxID, docPath)
			brokenPath := filepath.Join(filepath.Dir(docPath), "20260918000000-abcdefg.sy")
			if err := os.WriteFile(brokenPath, []byte(test.data), 0644); err != nil {
				t.Fatal(err)
			}
			items, err := MissingAssets()
			if err == nil || !strings.Contains(err.Error(), brokenPath) || !strings.Contains(err.Error(), "incomplete") {
				t.Fatalf("skipped document must be reported: %+v, %v", items, err)
			}
			if len(items) != 1 || items[0].Item != "assets/missing.png" {
				t.Fatalf("readable documents must still be scanned: %+v, %v", items, err)
			}
			if test.name == "new spec" && !errors.Is(err, treenode.ErrSpecTooNew) {
				t.Fatalf("lost spec error: %v", err)
			}
			if data, readErr := os.ReadFile(brokenPath); readErr != nil || string(data) != test.data {
				t.Fatalf("scan modified unreadable document: %q, %v", data, readErr)
			}
		})
	}
}

func TestMissingAssetsSkipClosedNotebook(t *testing.T) {
	boxID, docPath := setupUnusedAssetWorkspace(t)
	if err := os.WriteFile(docPath, []byte(`{"Type":`), 0644); err != nil {
		t.Fatal(err)
	}
	boxConf := conf.NewBoxConf()
	boxConf.Closed = true
	if err := (&Box{ID: boxID}).SaveConf(boxConf); err != nil {
		t.Fatal(err)
	}
	if items, err := MissingAssets(); err != nil || len(items) != 0 {
		t.Fatalf("closed notebooks must remain excluded: %+v, %v", items, err)
	}
}
