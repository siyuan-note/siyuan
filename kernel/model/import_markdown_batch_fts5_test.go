//go:build fts5 && sqlcipher

package model

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestMarkdownImportBatchesPreserveReferencesAndEncryption(t *testing.T) {
	for _, encrypted := range []bool{false, true} {
		t.Run(map[bool]string{false: "plain", true: "encrypted"}[encrypted], func(t *testing.T) {
			const boxID = "20261010000000-batch01"
			setupExportRelatedTest(t, boxID)
			Conf.Editor = conf.NewEditor()
			setupNotebookDocumentImportDatabase(t)
			t.Cleanup(func() { cache.ClearTreeCache(); cache.ClearDocsIAL(); cache.ClearBlocksIAL() })
			if encrypted {
				forgetRuntimeNormalBox(boxID)
				markRuntimeEncryptedBox(boxID)
				dek := bytes.Repeat([]byte{0x73}, 32)
				setDEKForTest(boxID, dek)
				boxConf := conf.NewBoxConf()
				boxConf.Encrypted = true
				boxConf.BoxCrypt = &conf.BoxEncryption{Spec: boxEncryptionSpec}
				if err := encryptBoxMetadata(boxID, boxConf, dek); err != nil {
					t.Fatal(err)
				}
				config, err := json.Marshal(boxConf)
				if err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(filepath.Join(util.DataDir, boxID, ".siyuan", "conf.json"), config, 0600); err != nil {
					t.Fatal(err)
				}
				mountedEncryptedBoxes.Store(boxID, true)
				if err := sql.OpenEncryptedDB(boxID, dek); err != nil {
					t.Fatal(err)
				}
				if err := treenode.OpenEncryptedBlockTreeDB(boxID, dek); err != nil {
					t.Fatal(err)
				}
				t.Cleanup(func() {
					sql.CloseEncryptedDB(boxID)
					treenode.CloseEncryptedBlockTreeDB(boxID)
					mountedEncryptedBoxes.Delete(boxID)
					encryptedBoxLifecycles.Delete(boxID)
					cachedDEKsLock.Lock()
					delete(cachedDEKs, boxID)
					cachedDEKsLock.Unlock()
				})
			}
			source := t.TempDir()
			if err := os.MkdirAll(filepath.Join(source, "assets"), 0755); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(source, "assets", "file.txt"), []byte("private asset content"), 0600); err != nil {
				t.Fatal(err)
			}
			count := 2*markdownImportBatchDocuments + 1
			for i := range count {
				markdown := fmt.Sprintf("# Heading %03d\n\n[[doc-%03d|next]] [[doc-%03d#Heading %03d|heading]] [[doc-%03d]]\n\n[asset](assets/file.txt)\n\nText[^note].\n\n[^note]: footnote %03d\n", i, (i+1)%count, (i+1)%count, (i+1)%count, (i+1)%count, i)
				if err := os.WriteFile(filepath.Join(source, fmt.Sprintf("doc-%03d.md", i)), []byte(markdown), 0600); err != nil {
					t.Fatal(err)
				}
			}
			if err := os.MkdirAll(filepath.Join(source, "parent"), 0755); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(source, "parent.md"), []byte("---\ndate: 2020-01-02\ntitle: Renamed parent\n---\n\n[[parent/child|child]]"), 0600); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(source, "parent", "child.markdown"), []byte("child content"), 0600); err != nil {
				t.Fatal(err)
			}
			if err := ImportFromLocalPathSkipRoot(boxID, source, "/"); err != nil {
				t.Fatal(err)
			}
			if staged, err := filepath.Glob(filepath.Join(util.TempDir, "markdown-import-*")); err != nil || len(staged) != 0 {
				t.Fatalf("staging files remained after import: %v, %v", staged, err)
			}
			for i := range count {
				current := treenode.GetBlockTreeRootByHPath(boxID, fmt.Sprintf("/doc-%03d", i))
				next := treenode.GetBlockTreeRootByHPath(boxID, fmt.Sprintf("/doc-%03d", (i+1)%count))
				if current == nil || next == nil {
					t.Fatalf("missing imported document %d", i)
				}
				cache.ClearTreeCache()
				tree, err := filesys.LoadTree(boxID, current.Path, util.NewLute())
				if err != nil {
					t.Fatal(err)
				}
				var documentRef, headingRef, dynamicRef, asset bool
				footnotes := 0
				ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
					if !entering {
						return ast.WalkContinue
					}
					if n.IsTextMarkType("block-ref") && n.TextMarkTextContent == "next" {
						documentRef = n.TextMarkBlockRefID == next.ID
					}
					if n.IsTextMarkType("block-ref") && n.TextMarkTextContent == "heading" {
						block := treenode.GetBlockTreeInBox(n.TextMarkBlockRefID, boxID)
						headingRef = block != nil && block.RootID == next.ID && block.Type == "h"
					}
					if n.IsTextMarkType("block-ref") && n.TextMarkBlockRefSubtype == "d" {
						dynamicRef = n.TextMarkBlockRefID == next.ID
					}
					if n.IsTextMarkType("a") && strings.HasPrefix(n.TextMarkAHref, "assets/") {
						asset = !encrypted || strings.Contains(n.TextMarkAHref, "?box="+boxID)
					}
					if n.IsTextMarkType("block-ref") && n.IsTextMarkType("sup") {
						footnotes++
						if n.TextMarkBlockRefSubtype != "s" || treenode.GetNodeInTree(tree, n.TextMarkBlockRefID) == nil {
							t.Error("footnote lost its local static target")
						}
					}
					return ast.WalkContinue
				})
				if !documentRef || !headingRef || !dynamicRef || !asset {
					t.Fatalf("document %d lost links: doc=%v heading=%v dynamic=%v asset=%v", i, documentRef, headingRef, dynamicRef, asset)
				}
				if footnotes != 1 {
					t.Fatal("footnote did not survive staging")
				}
				data, err := os.ReadFile(filepath.Join(util.DataDir, boxID, current.Path))
				if err != nil || encrypted && !IsEncryptedNotebookData(data) {
					t.Fatal("encrypted import wrote a plaintext document")
				}
			}
			parent := treenode.GetBlockTreeRootByHPath(boxID, "/Renamed parent")
			child := treenode.GetBlockTreeRootByHPath(boxID, "/parent/child")
			if parent == nil || child == nil || !strings.HasPrefix(child.Path, "/"+parent.ID+"/") {
				t.Fatal("front matter root ID did not relocate child documents")
			}
			if _, err := os.Stat(filepath.Join(source, "doc-000.md")); err != nil {
				t.Fatal("import altered source Markdown")
			}
			if encrypted {
				cachedDEKsLock.Lock()
				delete(cachedDEKs, boxID)
				cachedDEKsLock.Unlock()
				if _, err := filesys.LoadTree(boxID, child.Path, util.NewLute()); err == nil {
					t.Fatal("completed import bypassed locked-notebook access")
				}
			}
		})
	}
}

func TestMarkdownImportSingleFileSkipsStaging(t *testing.T) {
	const boxID = "20261010000000-single1"
	setupExportRelatedTest(t, boxID)
	Conf.Editor = conf.NewEditor()
	setupNotebookDocumentImportDatabase(t)
	source := filepath.Join(t.TempDir(), "source.md")
	original := []byte("# Single document\n\nContent")
	if err := os.WriteFile(source, original, 0600); err != nil {
		t.Fatal(err)
	}
	util.TempDir = source
	if err := ImportFromLocalPath(boxID, source, "/"); err != nil {
		t.Fatal(err)
	}
	if tree := treenode.GetBlockTreeRootByHPath(boxID, "/source"); tree == nil {
		t.Fatal("single document was not imported")
	}
	if got, err := os.ReadFile(source); err != nil || !bytes.Equal(got, original) {
		t.Fatal("single import changed source Markdown")
	}
}

func TestMarkdownImportStagingFailurePreservesSource(t *testing.T) {
	const boxID = "20261010000000-error01"
	setupExportRelatedTest(t, boxID)
	Conf.Editor = conf.NewEditor()
	sourceDir := t.TempDir()
	source := filepath.Join(sourceDir, "source.md")
	original := []byte("# source content")
	if err := os.WriteFile(source, original, 0600); err != nil {
		t.Fatal(err)
	}
	util.TempDir = filepath.Join(util.TempDir, "missing", "directory")
	if err := ImportFromLocalPath(boxID, sourceDir, "/"); err == nil {
		t.Fatal("staging failure was reported as success")
	}
	if got, err := os.ReadFile(source); err != nil || !bytes.Equal(got, original) {
		t.Fatal("failed import changed source Markdown")
	}
}
