// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5

package model

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/88250/lute/render"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestDocumentTitleConditionalCommit(t *testing.T) {
	if !documentTitleFeatureTestProcess(t) {
		return
	}
	boxID := prepareDocumentTitleFeatureBox(t)
	testDocumentTitleConditionalCommit(t, boxID)
	testDocumentTitleCommitDescendantPaths(t, boxID)
	testDocumentTitlePlainStorage(t, boxID)
}

func testDocumentTitlePlainStorage(t *testing.T, boxID string) {
	t.Run("plain storage, rich transitions and title-only undo", func(t *testing.T) {
		tree := newHPathTestDoc(t, boxID, "/", "Original", 1)
		bodyID := tree.Root.FirstChild.ID
		sql.FlushQueue()
		write := func(paragraph *ast.Node) *Transaction {
			t.Helper()
			current, err := GetDocTitle(tree.ID, boxID)
			if err != nil {
				t.Fatal(err)
			}
			source, err := render.NewDocumentTitle(paragraph)
			if err != nil {
				t.Fatal(err)
			}
			tx := &Transaction{DoOperations: []*Operation{{Action: "setDocTitle", ID: tree.ID,
				Data: map[string]any{"source": source, "expectedRevision": current.Revision}}}}
			if err = PerformTxSync(tx); err != nil {
				t.Fatal(err)
			}
			sql.FlushQueue()
			return tx
		}
		check := func(format, text string, empty bool) {
			t.Helper()
			current, raw, err := filesys.LoadTreeSnapshot(boxID, tree.Path, util.NewLute())
			if err != nil {
				t.Fatal(err)
			}
			value, err := GetDocTitle(tree.ID, boxID)
			if err != nil || value.Format != format || value.Text != text || value.Empty != empty ||
				(current.Root.DocumentTitle == nil) != (format == "plain") || treenode.GetNodeInTree(current, bodyID) == nil {
				t.Fatalf("title storage or body changed: %+v %v", value, err)
			}
			if IsEncryptedBox(boxID) && !util.IsCiphertext(raw) {
				t.Fatal("title storage change exposed plaintext on disk")
			}
			box := &Box{ID: boxID}
			file := box.docFromFileInfo(box.Stat(tree.Path), box.docIAL(tree.Path))
			if file.TitleFormat != format || file.TitleRevision != value.Revision {
				t.Fatalf("document tree metadata disagrees with source: %+v", file)
			}
		}
		for _, text := range []string{"", "**literal** A/B <tag> &amp;"} {
			paragraph := &ast.Node{Type: ast.NodeParagraph}
			paragraph.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte(text)})
			write(paragraph)
			check("plain", text, text == "")
		}
		rich := &ast.Node{Type: ast.NodeParagraph}
		rich.AppendChild(&ast.Node{Type: ast.NodeTextMark, TextMarkType: "strong", TextMarkTextContent: "Rich"})
		write(rich)
		check("inline-ast", "Rich", false)
		plain := &ast.Node{Type: ast.NodeParagraph}
		plain.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("Plain again")})
		tx := write(plain)
		check("plain", "Plain again", false)
		for index, operations := range [][]*Operation{tx.UndoOperations, tx.DoOperations} {
			replay := &Transaction{DoOperations: cloneOperations(operations)}
			replay.MarkReplay()
			if err := PerformTxSync(replay); err != nil {
				t.Fatal(err)
			}
			sql.FlushQueue()
			if index == 0 {
				check("inline-ast", "Rich", false)
			} else {
				check("plain", "Plain again", false)
			}
		}
	})
}

func titleWriteTestSource(t *testing.T, text string) *ast.DocumentTitle {
	t.Helper()
	paragraph := &ast.Node{Type: ast.NodeParagraph}
	paragraph.AppendChild(&ast.Node{Type: ast.NodeTextMark, TextMarkType: "strong", TextMarkTextContent: text})
	source, err := render.NewDocumentTitle(paragraph)
	if err != nil {
		t.Fatal(err)
	}
	return source
}

func titleWriteTestTransaction(t *testing.T, tree *parse.Tree, text string) *Transaction {
	t.Helper()
	data, err := GetDocTitle(tree.ID, tree.Box)
	if err != nil {
		t.Fatal(err)
	}
	return &Transaction{DoOperations: []*Operation{{Action: "setDocTitle", ID: tree.ID,
		Data: map[string]any{"source": titleWriteTestSource(t, text), "expectedRevision": data.Revision}}}}
}

func testDocumentTitleConditionalCommit(t *testing.T, boxID string) {
	for _, replay := range []bool{false, true} {
		for _, mutation := range []string{"body", "title"} {
			name := "save/" + mutation
			if replay {
				name = "undo/" + mutation
			}
			t.Run(name, func(t *testing.T) {
				tree := newHPathTestDoc(t, boxID, "/", "Original", 1)
				sql.FlushQueue()
				tx := titleWriteTestTransaction(t, tree, "Changed/A／B")
				if replay {
					if err := PerformTxSync(tx); err != nil {
						t.Fatal(err)
					}
					sql.FlushQueue()
					tx = &Transaction{DoOperations: cloneOperations(tx.UndoOperations)}
					tx.MarkReplay()
				}
				var concurrent []byte
				var concurrentRevision, addedBodyID string
				injected := false
				tx.writeTransactionTree = func(proposed *parse.Tree) error {
					injected = true
					current, _, err := filesys.LoadTreeSnapshot(tree.Box, tree.Path, util.NewLute())
					if err != nil {
						return err
					}
					if mutation == "body" {
						body := treenode.NewParagraph("")
						body.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("Concurrent body must survive")})
						current.Root.AppendChild(body)
						addedBodyID = body.ID
					} else {
						current.Root.DocumentTitle = titleWriteTestSource(t, "Concurrent/A／B")
						if err = treenode.RefreshDocumentTitle(current.Root); err != nil {
							return err
						}
					}
					if err = indexWriteTreeUpsertQueue(current); err != nil {
						return err
					}
					concurrentRevision = treenode.DocumentTitleRevision(current.Root)
					concurrent, err = os.ReadFile(filepath.Join(util.DataDir, tree.Box, tree.Path))
					if err != nil {
						return err
					}
					return tx.writeDocumentTitleTree(proposed, nil)
				}
				if err := PerformTxSync(tx); !errors.Is(err, ErrDocumentTitleConflict) || !injected {
					t.Fatalf("write-window conflict was not preserved: injected=%v err=%v", injected, err)
				}
				current, raw, err := filesys.LoadTreeSnapshot(tree.Box, tree.Path, util.NewLute())
				if err != nil || !bytes.Equal(concurrent, raw) {
					t.Fatalf("conflict overwrote concurrent source bytes: %v", err)
				}
				if treenode.DocumentTitleRevision(current.Root) != concurrentRevision ||
					(addedBodyID != "" && treenode.GetNodeInTree(current, addedBodyID) == nil) {
					t.Fatal("conflict lost concurrent title or body")
				}
				if IsEncryptedBox(boxID) && !util.IsCiphertext(raw) {
					t.Fatal("conflict replaced ciphertext with plaintext")
				}
				sql.FlushQueue()
				drainHPathRefreshTest(t)
				metadata, err := getDocumentPath(boxID, tree.ID)
				if err != nil || metadata.Title.Text != treenode.ReadDocumentTitle(current.Root).Text {
					t.Fatalf("recovery published rejected title metadata: %+v %v", metadata, err)
				}
			})
		}
	}
}

func testDocumentTitleCommitDescendantPaths(t *testing.T, boxID string) {
	t.Run("descendant paths and source-only replay", func(t *testing.T) {
		parent := newHPathTestDoc(t, boxID, "/", "Original parent", 1)
		child := newHPathTestDoc(t, boxID, parent.Path, "Child", 1)
		childPath := filepath.Join(util.DataDir, child.Box, child.Path)
		childBefore, err := os.ReadFile(childPath)
		if err != nil {
			t.Fatal(err)
		}
		sql.FlushQueue()
		tx := titleWriteTestTransaction(t, parent, "New/A／B")
		check := func(want string) {
			t.Helper()
			sql.FlushQueue()
			drainHPathRefreshTest(t)
			if bt := treenode.GetBlockTreeInExactBox(child.ID, boxID); bt == nil || bt.HPath != want {
				t.Fatalf("descendant path not refreshed: %+v, want %s", bt, want)
			}
			if after, err := os.ReadFile(childPath); err != nil || !bytes.Equal(childBefore, after) {
				t.Fatalf("title update rewrote descendant source: %v", err)
			}
		}
		if err = PerformTxSync(tx); err != nil {
			t.Fatal(err)
		}
		check("/New/A／B/Child")
		undo := &Transaction{DoOperations: cloneOperations(tx.UndoOperations)}
		undo.MarkReplay()
		if err = PerformTxSync(undo); err != nil {
			t.Fatal(err)
		}
		check("/Original parent/Child")
		redo := &Transaction{DoOperations: cloneOperations(tx.DoOperations)}
		redo.MarkReplay()
		if err = PerformTxSync(redo); err != nil {
			t.Fatal(err)
		}
		check("/New/A／B/Child")
	})
}
