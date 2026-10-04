package model

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestExportTreeMissingFileAnnotationRef(t *testing.T) {
	fixture := setupFileOperationTest(t)
	originalWorkspaceDir := util.WorkspaceDir
	util.WorkspaceDir = filepath.Dir(util.DataDir)
	t.Cleanup(func() { util.WorkspaceDir = originalWorkspaceDir })
	Conf.Export, Conf.Editor = conf.NewExport(), conf.NewEditor()
	assetPath := filepath.Join(util.DataDir, "assets", "document.pdf")
	if err := os.MkdirAll(filepath.Dir(assetPath), 0755); err != nil {
		t.Fatal(err)
	}
	for _, file := range []struct{ path, data string }{{assetPath, "PDF"}, {assetPath + ".sya", `{}`}} {
		if err := os.WriteFile(file.path, []byte(file.data), 0644); err != nil {
			t.Fatal(err)
		}
	}
	for _, syaExists := range []bool{true, false} {
		if !syaExists {
			if err := os.Remove(assetPath + ".sya"); err != nil {
				t.Fatal(err)
			}
		}
		for _, wysiwyg := range []bool{false, true} {
			for _, mode := range []int{0, 1} {
				tree := treenode.NewTree(fixture.box.ID, "/"+ast.NewNodeID()+".sy", "/Annotation", "Annotation")
				node := &ast.Node{Type: ast.NodeTextMark, TextMarkType: "file-annotation-ref",
					TextMarkFileAnnotationRefID: "assets/document.pdf/20260817235351-rp33lbv", TextMarkTextContent: "retained annotation"}
				tree.Root.FirstChild.AppendChild(node)
				exported, err := exportTree(tree, true, true, wysiwyg, true,
					0, 0, mode, "#", "#", "", "", false, "", false, true, nil, nil)
				if err != nil {
					t.Fatalf("wysiwyg=%v mode=%d: %v", wysiwyg, mode, err)
				}
				foundText := false
				ast.Walk(exported.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
					if entering {
						if n.Type == ast.NodeText && string(n.Tokens) == "retained annotation" {
							foundText = true
						}
						if n.Type == ast.NodeLink || n.IsTextMarkType("file-annotation-ref") {
							t.Fatal("export retained a dangling annotation link")
						}
					}
					return ast.WalkContinue
				})
				if !foundText {
					t.Fatal("export lost annotation text")
				}
				if node.TextMarkFileAnnotationRefID == "" {
					t.Fatal("export modified the source reference")
				}
			}
		}
	}
}

func TestProcessFileAnnotationRef(t *testing.T) {
	const annotationID = "20260817235351-rp33lbv"
	for _, format := range []string{"plain", "encrypted", "legacy encrypted"} {
		t.Run(format, func(t *testing.T) {
			fixture := setupFileOperationTest(t)
			boxID := fixture.box.ID
			var dek []byte
			assetDir := filepath.Join(util.DataDir, "assets")
			if format != "plain" {
				boxID = "20261003000000-abcdefg"
				t.Cleanup(prepareEncryptedBoxLifecycleTest(t, boxID))
				var err error
				dek, err = GetDEKIfUnlocked(boxID)
				if err != nil {
					t.Fatal(err)
				}
				t.Cleanup(func() { clear(dek) })
				assetDir = filepath.Join(util.DataDir, boxID, "assets")
			}
			originalWorkspaceDir := util.WorkspaceDir
			util.WorkspaceDir = filepath.Dir(util.DataDir)
			t.Cleanup(func() { util.WorkspaceDir = originalWorkspaceDir })
			if err := os.MkdirAll(assetDir, 0755); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(assetDir, "document.pdf"), []byte("PDF"), 0644); err != nil {
				t.Fatal(err)
			}
			for _, scenario := range []struct {
				name, data, wantDest string
				wantErr              bool
			}{
				{"deleted", `{}`, "", false},
				{"page", `{"` + annotationID + `":{"page":2}}`, "assets/document.pdf#page=3", false},
				{"pages", `{"` + annotationID + `":{"pages":[{"index":4}]}}`, "assets/document.pdf#page=5", false},
				{"invalid page", `{"` + annotationID + `":{"page":-1}}`, "", true},
				{"missing page", `{"` + annotationID + `":{}}`, "", true},
				{"invalid JSON", `{broken`, "", true},
				{"null JSON", `null`, "", true},
				{"missing file", "", "", false},
				{"corrupt ciphertext", `{}`, "", format != "plain"},
			} {
				t.Run(scenario.name, func(t *testing.T) {
					syaPath := filepath.Join(assetDir, "document.pdf.sya")
					data := []byte(scenario.data)
					if len(data) > 0 && format != "plain" {
						if format == "legacy encrypted" {
							data = legacyEncryptedAssetFixture(t, boxID, "document.pdf.sya", "document.pdf.sya", dek, data)
						} else {
							var err error
							data, err = EncryptAsset(boxID, "document.pdf.sya", "document.pdf.sya", dek, data)
							if err != nil {
								t.Fatal(err)
							}
						}
						if scenario.name == "corrupt ciphertext" {
							data[len(data)-5] ^= 1
						}
					}
					if len(data) == 0 {
						if err := os.Remove(syaPath); err != nil && !os.IsNotExist(err) {
							t.Fatal(err)
						}
					} else if err := os.WriteFile(syaPath, data, 0644); err != nil {
						t.Fatal(err)
					}
					for _, mode := range []int{0, 1} {
						paragraph := &ast.Node{Type: ast.NodeParagraph}
						node := &ast.Node{Type: ast.NodeTextMark, TextMarkType: "file-annotation-ref", TextMarkTextContent: "annotation text"}
						paragraph.AppendChild(node)
						refID := "assets/document.pdf/" + annotationID
						err := processFileAnnotationRef(refID, node, mode, boxID)
						if (err != nil) != scenario.wantErr {
							t.Fatalf("mode=%d: unexpected error %v", mode, err)
						}
						if scenario.wantErr {
							if paragraph.FirstChild != node {
								t.Fatal("failed resolution produced exported content")
							}
						} else if scenario.wantDest == "" {
							if text := paragraph.FirstChild; text.Type != ast.NodeText || string(text.Tokens) != node.TextMarkTextContent {
								t.Fatal("deleted annotation did not retain its text")
							}
						} else {
							link := paragraph.FirstChild
							if link.Type != ast.NodeLink || string(link.ChildByType(ast.NodeLinkDest).Tokens) != scenario.wantDest {
								t.Fatal("valid annotation lost its page link")
							}
							text := string(link.ChildByType(ast.NodeLinkText).Tokens)
							if !strings.HasSuffix(text, node.TextMarkTextContent) || (mode == 1 && text != node.TextMarkTextContent) {
								t.Fatalf("invalid anchor text %q", text)
							}
						}
						if len(data) > 0 {
							stored, err := os.ReadFile(syaPath)
							if err != nil || !bytes.Equal(stored, data) {
								t.Fatalf("export modified the annotation file: %v", err)
							}
						}
					}
				})
			}
		})
	}
}
