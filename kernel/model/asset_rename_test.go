//go:build fts5

package model

import (
	"bytes"
	"encoding/json"
	"net/url"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestRenameAssetReferences(t *testing.T) {
	const childEnv = "SIYUAN_TEST_ASSET_RENAME"
	if os.Getenv(childEnv) == "" {
		cmd := exec.Command(os.Args[0], "-test.run=^TestRenameAssetReferences$", "-test.timeout=60s")
		cmd.Env = append(os.Environ(), childEnv+"=1")
		if output, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("%v\n%s", err, output)
		}
		return
	}
	fixture := setupFileOperationTest(t)
	setupAttributeViewRefI18n(t)
	util.WorkspaceDir = filepath.Dir(util.DataDir)
	util.ConfDir = t.TempDir()
	util.HistoryDir, util.TempDir = t.TempDir(), t.TempDir()
	util.QueueDir = filepath.Join(util.TempDir, "queue")
	util.HistoryDBPath = filepath.Join(util.TempDir, "history.db")
	util.DBPath = filepath.Join(util.TempDir, "siyuan.db")
	util.AssetContentDBPath = filepath.Join(util.TempDir, "asset_content.db")
	sql.InitDatabase(true)
	sql.InitAssetContentDatabase(true)
	sql.InitHistoryDatabase(true)
	t.Cleanup(sql.CloseDatabase)
	if newPath, err := RenameAsset("assets/missing.pdf", "renamed"); err == nil || newPath != "" {
		t.Fatalf("missing asset must fail without a new path: %s %v", newPath, err)
	}

	for _, test := range []struct {
		name, id, suffix string
		boxAsset         bool
	}{
		{"global", "20261009000001-abcdefg", "", false},
		{"fragment", "20261009000002-abcdefg", "#annotation", false},
		{"query", "20261009000003-abcdefg", "?page=2#annotation", false},
		{"notebook", "20261009000004-abcdefg", "?box=" + fixture.box.ID + "&page=2#annotation", true},
	} {
		t.Run(test.name, func(t *testing.T) {
			oldPath := "assets/习题-" + test.id + ".pdf"
			assetDiskPath := oldPath
			if test.boxAsset {
				assetDiskPath = fixture.box.ID + "/" + oldPath
			}
			writeAssetRelinkTestFile(t, assetDiskPath, []byte("PDF content"))
			writeAssetRelinkTestFile(t, assetDiskPath+".sya", []byte(`{"annotation":"content"}`))
			util.SetAssetText(oldPath, "OCR content")
			encodedPath := (&url.URL{Path: oldPath}).EscapedPath()
			hrefs := []string{oldPath + test.suffix, encodedPath + test.suffix, encodedPath + "?page=9#other"}
			tree := treenode.NewTree(fixture.box.ID, "/"+test.id+".sy", "/References", "References")
			for _, href := range hrefs {
				p := treenode.NewParagraph(ast.NewNodeID())
				p.AppendChild(&ast.Node{Type: ast.NodeTextMark, TextMarkType: "a", TextMarkAHref: href, TextMarkTextContent: href})
				tree.Root.AppendChild(p)
			}
			if _, err := filesys.WriteTree(tree); err != nil {
				t.Fatal(err)
			}
			treenode.UpsertBlockTree(tree)
			t.Cleanup(func() { cache.RemoveTreeData(tree.ID) })
			avPath := filepath.Join(util.DataDir, "storage", "av", test.id+".json")
			avData, _ := json.Marshal(map[string]interface{}{"paths": hrefs, "text": path.Base(oldPath)})
			writeAssetRelinkTestFile(t, "storage/av/"+test.id+".json", avData)

			newPath, err := RenameAsset(oldPath+test.suffix, "习题2")
			if err != nil || newPath == "" {
				t.Fatalf("rename failed: %s %v", newPath, err)
			}
			newCleanPath := strings.TrimSuffix(newPath, test.suffix)
			if newPath != newCleanPath+test.suffix || !strings.HasPrefix(newCleanPath, "assets/习题2-") {
				t.Fatalf("unexpected renamed URL: %s", newPath)
			}
			newDiskPath := filepath.Join(filepath.Dir(filepath.Join(util.DataDir, assetDiskPath)), path.Base(newCleanPath))
			for _, suffix := range []string{"", ".sya"} {
				data, readErr := os.ReadFile(newDiskPath + suffix)
				if readErr != nil || len(data) == 0 {
					t.Fatalf("renamed file %s: %s %v", suffix, data, readErr)
				}
				if _, statErr := os.Stat(filepath.Join(util.DataDir, assetDiskPath) + suffix); !os.IsNotExist(statErr) {
					t.Fatalf("old file remains: %v", statErr)
				}
			}
			loaded, err := filesys.LoadTree(fixture.box.ID, tree.Path, util.NewLute())
			if err != nil {
				t.Fatal(err)
			}
			want := []string{newCleanPath + test.suffix, (&url.URL{Path: newCleanPath}).EscapedPath() + test.suffix,
				(&url.URL{Path: newCleanPath}).EscapedPath() + "?page=9#other"}
			var got []string
			ast.Walk(loaded.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
				if entering && n.IsTextMarkType("a") {
					got = append(got, n.TextMarkAHref)
					if n.TextMarkTextContent != n.TextMarkAHref {
						t.Errorf("link label was not updated: %s", n.TextMarkTextContent)
					}
				}
				return ast.WalkContinue
			})
			if strings.Join(got, "\n") != strings.Join(want, "\n") {
				t.Fatalf("document references: %v, want %v", got, want)
			}
			updated, err := os.ReadFile(avPath)
			wantAV, _ := json.Marshal(map[string]interface{}{"paths": want, "text": path.Base(oldPath)})
			if err != nil || !bytes.Equal(updated, wantAV) {
				t.Fatalf("database references: %s, want %s: %v", updated, wantAV, err)
			}
			if util.GetAssetText(newCleanPath) != "OCR content" {
				t.Fatal("OCR metadata was not preserved")
			}
		})
	}
	const encryptedBox = "20261009000005-crypt00"
	writeAssetRelinkTestFile(t, encryptedBox+"/.siyuan/conf.json", []byte(`{"encrypted":true}`))
	writeAssetRelinkTestFile(t, encryptedBox+"/assets/secret.pdf", []byte("encrypted asset fixture"))
	t.Cleanup(func() { forgetRuntimeEncryptedBox(encryptedBox) })
	if newPath, err := RenameAsset("assets/secret.pdf?box="+encryptedBox+"#x", "renamed"); err == nil || newPath != "" {
		t.Fatalf("encrypted asset rename must fail without a new path: %s %v", newPath, err)
	}
	data, err := os.ReadFile(filepath.Join(util.DataDir, encryptedBox, "assets", "secret.pdf"))
	if err != nil || string(data) != "encrypted asset fixture" {
		t.Fatalf("encrypted asset changed: %s %v", data, err)
	}
}

func TestRenameAssetAttributeViewEncodedPath(t *testing.T) {
	const oldPath = "assets/习题-20261009000001-abcdefg.pdf"
	const newPath = "assets/习题2-20261009000002-abcdefg.pdf"
	const avID = "20261009000003-abcdefg"
	avPath := filepath.Join(t.TempDir(), avID+".json")
	data, _ := json.Marshal([]string{oldPath + "?page=2#x", (&url.URL{Path: oldPath}).EscapedPath() + "?page=3#y", path.Base(oldPath)})
	if err := os.WriteFile(avPath, data, 0644); err != nil {
		t.Fatal(err)
	}
	updated, err := replaceAttributeViewAssetPath(avPath, avID, oldPath+"?page=1#z", newPath+"?page=1#z")
	if err != nil || !updated {
		t.Fatalf("rewrite database: %v %v", updated, err)
	}
	got, err := os.ReadFile(avPath)
	want, _ := json.Marshal([]string{newPath + "?page=2#x", (&url.URL{Path: newPath}).EscapedPath() + "?page=3#y", path.Base(oldPath)})
	if err != nil || !bytes.Equal(got, want) {
		t.Fatalf("database references: %s, want %s: %v", got, want, err)
	}
}
