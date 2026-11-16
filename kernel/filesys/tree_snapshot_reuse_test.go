// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package filesys

import (
	"bytes"
	"cmp"
	"fmt"
	"io"
	"os"
	"slices"
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/render"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
	"golang.org/x/net/html"
)

func TestTreeSnapshotReuseMatchesReparsedSource(t *testing.T) {
	for _, encrypted := range []bool{false, true} {
		for _, rich := range []bool{false, true} {
			for _, repair := range []bool{false, true} {
				t.Run(fmt.Sprintf("encrypted=%t/rich=%t/repair=%t", encrypted, rich, repair), func(t *testing.T) {
					box, _, _, _ := setupStalePathTest(t)
					provider, acquire, release := DEKProvider, DEKLockAcquire, DEKLockRelease
					DEKLockAcquire, DEKLockRelease = nil, nil
					var dek []byte
					if encrypted {
						dek = bytes.Repeat([]byte{23}, 32)
					}
					DEKProvider = func(string) ([]byte, error) { return bytes.Clone(dek), nil }
					t.Cleanup(func() { DEKProvider, DEKLockAcquire, DEKLockRelease = provider, acquire, release })
					legacy, err := os.ReadFile("../treenode/testdata/table-cell-legacy.sy")
					if err != nil {
						t.Fatal(err)
					}
					engine := util.NewLute()
					tree, _, err := treenode.ParseJSON(legacy, engine.ParseOptions)
					if err != nil {
						t.Fatal(err)
					}
					tree.Box, tree.Path = box, "/"+tree.Root.ID+".sy"
					if rich {
						tree.Root.FirstChild.LastChild.FirstChild.TableCellRich = &ast.TableCellRich{Spec: 1, Format: "kramdown", Content: "**bold** [link](assets/example.pdf)\n\n- first\n- second"}
						paragraph := &ast.Node{Type: ast.NodeParagraph}
						paragraph.AppendChild(&ast.Node{Type: ast.NodeTextMark, TextMarkType: "strong", TextMarkTextContent: "Rich title"})
						if err = treenode.SetDocumentTitleParagraph(tree.Root, paragraph); err != nil {
							t.Fatal(err)
						}
					}
					if err = treenode.RefreshTableCellRichProjection(tree.Root); err != nil {
						t.Fatal(err)
					}
					if _, err = WriteTree(tree); err != nil {
						t.Fatal(err)
					}
					_, plain, err := LoadTreeSnapshot(box, tree.Path, engine)
					if err != nil {
						t.Fatal(err)
					}
					plain, err = decryptDataWithDEK(box, tree.Path, plain, dek)
					if err != nil {
						t.Fatal(err)
					}
					if repair {
						plain = append([]byte("\xef\xbb\xbf"), plain...)
					}
					original, err := encryptDataWithDEK(box, tree.Path, plain, dek)
					if err != nil {
						t.Fatal(err)
					}
					filename := writeStalePathFixture(t, box, tree.Path, original)
					mode, err := validateTreePathMode(box, tree.Path)
					if err != nil {
						t.Fatal(err)
					}
					fixed, wantFix, err := fixTreeJSONDataInMode(box, tree.Path, plain, engine, dek, encrypted, false, mode)
					if err != nil || wantFix != repair {
						t.Fatalf("unexpected compatibility repair: %t %v", wantFix, err)
					}
					want, err := loadTreeByDataWithParentRecovery(fixed, box, tree.Path, engine, mode, false)
					if err != nil {
						t.Fatal(err)
					}
					got, baseline, needFix, err := LoadTreeSnapshotWithFix(box, tree.Path, engine)
					if err != nil || needFix != repair || !bytes.Equal(baseline, original) {
						t.Fatalf("snapshot source changed: %v", err)
					}
					encode := func() []byte { return render.NewJSONRenderer(got, engine.RenderOptions, engine.ParseOptions).Render() }
					expected := render.NewJSONRenderer(want, engine.RenderOptions, engine.ParseOptions).Render()
					if !bytes.Equal(encode(), expected) || got.ID != want.ID || got.Box != want.Box || got.Path != want.Path || got.HPath != want.HPath || got.Hash != want.Hash {
						t.Fatal("snapshot differs from fully reparsed source")
					}
					gotDOM, wantDOM := engine.RenderNodeBlockDOM(got.Root), engine.RenderNodeBlockDOM(want.Root)
					if canonicalSnapshotDOM(t, gotDOM) != canonicalSnapshotDOM(t, wantDOM) {
						t.Fatalf("snapshot projection differs: got %q want %q", gotDOM, wantDOM)
					}
					current, err := os.ReadFile(filename)
					if err != nil || !bytes.Equal(current, original) {
						t.Fatal("snapshot repaired source on disk", err)
					}
					got.Root.SetIALAttr("tags", "independent")
					again, _, err := LoadTreeSnapshot(box, tree.Path, engine)
					if err != nil || again.Root.IALAttr("tags") == "independent" {
						t.Fatal("snapshot shares mutable state", err)
					}
				})
			}
		}
	}
}

func canonicalSnapshotDOM(t *testing.T, source string) string {
	t.Helper()
	tokens := html.NewTokenizer(strings.NewReader(source))
	var result strings.Builder
	for {
		if tokens.Next() == html.ErrorToken {
			if tokens.Err() != io.EOF {
				t.Fatal(tokens.Err())
			}
			return result.String()
		}
		token := tokens.Token()
		slices.SortFunc(token.Attr, func(a, b html.Attribute) int {
			if order := cmp.Compare(a.Namespace, b.Namespace); order != 0 {
				return order
			}
			if order := cmp.Compare(a.Key, b.Key); order != 0 {
				return order
			}
			return cmp.Compare(a.Val, b.Val)
		})
		result.WriteString(token.String())
	}
}
