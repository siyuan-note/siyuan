// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5

package model

import (
	"bytes"
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestDocumentTitleHistoryRoundTrip(t *testing.T) {
	const helper = "SIYUAN_TEST_TITLE_HISTORY"
	if os.Getenv(helper) != "1" {
		ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
		defer cancel()
		command := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestDocumentTitleHistoryRoundTrip$", "-test.v")
		command.Env = append(os.Environ(), helper+"=1")
		if output, err := command.CombinedOutput(); err != nil {
			t.Fatalf("title history subprocess: %v\n%s", err, output)
		}
		return
	}
	prepareHPathRefreshTest(t)
	t.Cleanup(backgroundRefreshWaitGroup.Wait)
	Conf.Flashcard.Store(conf.NewFlashcard())
	box := &Box{ID: ast.NewNodeID()}
	boxConf := conf.NewBoxConf()
	boxConf.Closed = false
	if err := box.SaveConf(boxConf); err != nil {
		t.Fatal(err)
	}
	if _, err := Mount(box.ID); err != nil {
		t.Fatal(err)
	}
	testDocumentTitleHistoryRoundTrip(t, box.ID)
}

func testDocumentTitleHistoryRoundTrip(t *testing.T, boxID string) {
	t.Helper()
	tree := newHPathTestDoc(t, boxID, "/", "History", 1)
	body := tree.Root.FirstChild
	body.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("original body ")})
	body.AppendChild(&ast.Node{Type: ast.NodeTextMark, TextMarkType: "block-ref", TextMarkBlockRefID: body.ID,
		TextMarkBlockRefSubtype: "s", TextMarkTextContent: "body self-reference"})
	title := &ast.Node{Type: ast.NodeParagraph}
	title.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("Historical **literal** / ")})
	styled := &ast.Node{Type: ast.NodeTextMark, TextMarkType: "strong", TextMarkTextContent: "styled title"}
	styled.SetIALAttr("style", "color: red")
	title.AppendChild(styled)
	title.AppendChild(&ast.Node{Type: ast.NodeKramdownSpanIAL, Tokens: []byte(`{: style="color: red"}`)})
	title.AppendChild(&ast.Node{Type: ast.NodeTextMark, TextMarkType: "inline-memo", TextMarkTextContent: "visible memo", TextMarkInlineMemoContent: "private memo"})
	title.AppendChild(&ast.Node{Type: ast.NodeTextMark, TextMarkType: "block-ref", TextMarkBlockRefID: body.ID,
		TextMarkBlockRefSubtype: "s", TextMarkTextContent: "title reference"})
	luteEngine := util.NewLute()
	image := parse.Parse("", []byte(`![image alt](assets/history.png "image title")`), luteEngine.ParseOptions).Root.FirstChild.FirstChild
	title.AppendChild(image)
	if err := treenode.SetDocumentTitleParagraph(tree.Root, title); err != nil {
		t.Fatal(err)
	}
	wantSource := tree.Root.DocumentTitle.Content
	save := func(tree *parse.Tree) {
		t.Helper()
		if err := writeTreeUpsertQueue(tree); err != nil {
			t.Fatal(err)
		}
		treenode.UpsertBlockTree(tree)
		sql.FlushQueue()
	}
	save(tree)
	file := filepath.Join(util.DataDir, boxID, tree.Path)
	historyDir := filepath.Join(util.HistoryDir, "2026-10-25-130000-update")
	if err := generateDocHistoryFile(boxID, file, historyDir, luteEngine); err != nil {
		t.Fatal(err)
	}
	history := filepath.Join(historyDir, boxID, tree.Path)
	historicalBytes, err := os.ReadFile(history)
	if err != nil {
		t.Fatal(err)
	}
	currentBytes, err := os.ReadFile(file)
	if err != nil || !bytes.Equal(historicalBytes, currentBytes) || util.IsCiphertext(historicalBytes) != IsEncryptedBox(boxID) {
		t.Fatalf("snapshot did not preserve source bytes and envelope: %v", err)
	}
	relative, err := filepath.Rel(util.WorkspaceDir, history)
	if err != nil {
		t.Fatal(err)
	}
	if _, _, content, _, err := GetDocHistoryContent(relative, "", false); err != nil ||
		!strings.Contains(content, "styled title") || !strings.Contains(content, "assets/history.png") ||
		!strings.Contains(content, "original body") || !strings.Contains(content, `contenteditable="false"`) {
		t.Fatalf("history preview lost full title or body: %v\n%s", err, content)
	}
	if err = treenode.SetDocumentTitleParagraph(tree.Root, &ast.Node{Type: ast.NodeParagraph}); err != nil {
		t.Fatal(err)
	}
	save(tree)
	if err = RollbackDocHistory(relative); err != nil {
		t.Fatal(err)
	}
	sql.FlushQueue()
	restored, err := filesys.LoadTree(boxID, tree.Path, luteEngine)
	if err != nil || restored.ID != tree.ID || restored.Root.DocumentTitle == nil || restored.Root.DocumentTitle.Content != wantSource ||
		restored.Root.FirstChild.ID != body.ID || restored.Root.FirstChild.Next != nil {
		t.Fatalf("history restore lost title source or inserted a body block: %v", err)
	}
	// Move the historical target block to another document. Restoring the old
	// snapshot must allocate its duplicate ID and remap only references to it.
	other := newHPathTestDoc(t, boxID, "/", "Moved block", 1)
	other.Root.FirstChild.Unlink()
	other.Root.AppendChild(restored.Root.FirstChild)
	currentBody := treenode.NewParagraph("")
	currentBody.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("current body")})
	restored.Root.AppendChild(currentBody)
	save(restored)
	save(other)
	if err = RollbackDocHistory(relative); err != nil {
		t.Fatal(err)
	}
	sql.FlushQueue()
	restored, err = filesys.LoadTree(boxID, tree.Path, luteEngine)
	if err != nil || restored.ID != tree.ID || restored.Root.FirstChild.ID == body.ID {
		t.Fatalf("history duplicate target was not remapped: %v", err)
	}
	newID := restored.Root.FirstChild.ID
	refs := 0
	treenode.WalkWithInlineTitles(restored.Root, func(node *ast.Node, entering bool) ast.WalkStatus {
		if entering && treenode.IsBlockRef(node) {
			refs++
			if node.TextMarkBlockRefID != newID {
				t.Errorf("restored reference targets old duplicate: %s", node.TextMarkBlockRefID)
			}
		}
		return ast.WalkContinue
	})
	if refs != 2 {
		t.Fatalf("title/body references lost: %d", refs)
	}
	if got, err := os.ReadFile(history); err != nil || !bytes.Equal(historicalBytes, got) {
		t.Fatalf("recovery modified historical source: %v", err)
	}
	if IsEncryptedBox(boxID) {
		if got, err := os.ReadFile(file); err != nil || !util.IsCiphertext(got) || sql.GetBlock(tree.ID) != nil {
			t.Fatalf("recovery exposed encrypted title: %v", err)
		}
	}
}
