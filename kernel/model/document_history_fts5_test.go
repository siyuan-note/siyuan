// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5

package model

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func seedDocumentHistory(t *testing.T, rootIDs ...string) {
	t.Helper()
	previous := GlobalUndoLog
	GlobalUndoLog = newUndoLog(64)
	t.Cleanup(func() { GlobalUndoLog = previous })
	for _, id := range rootIDs {
		entry := &UndoEntry{id: id, mutatedRootIDs: []string{id}}
		GlobalUndoLog.stacks[id] = &undoStack{undoStack: []*UndoEntry{entry}, redoStack: []*UndoEntry{entry}}
	}
}

func TestRestoreDocumentHistoryRemapsConflictingReferences(t *testing.T) {
	for _, scenario := range []string{"existing", "deleted", "root-as-body", "foreign-root"} {
		t.Run(scenario, func(t *testing.T) {
			fixture := setupStructureTransactionTest(t)
			setupFoldTransactionDatabase(t, fixture)
			tree, err := LoadTreeByBlockID(fixture.sourceID)
			if err != nil {
				t.Fatal(err)
			}
			child := tree.Root.FirstChild
			oldChildID := child.ID
			for _, id := range []string{oldChildID, tree.ID, fixture.targetID} {
				child.AppendChild(&ast.Node{Type: ast.NodeTextMark, TextMarkType: "block-ref", TextMarkBlockRefID: id,
					TextMarkBlockRefSubtype: "s", TextMarkTextContent: id})
			}
			child.AppendChild(&ast.Node{Type: ast.NodeTextMark, TextMarkType: "a", TextMarkAHref: "siyuan://blocks/" + oldChildID + "?focus=1#anchor", TextMarkTextContent: "link"})
			child.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte(oldChildID)})
			embed := &ast.Node{Type: ast.NodeBlockQueryEmbed, ID: ast.NewNodeID()}
			embed.SetIALAttr("id", embed.ID)
			embed.AppendChild(&ast.Node{Type: ast.NodeBlockQueryEmbedScript, Tokens: []byte("select * from blocks where id='" + oldChildID + "'")})
			tree.Root.AppendChild(embed)
			tabs := &ast.Node{Type: ast.NodeTabs, ID: ast.NewNodeID()}
			tabs.SetIALAttr("id", tabs.ID)
			for range 2 {
				item := &ast.Node{Type: ast.NodeTabItem, ID: ast.NewNodeID(), TabItemTitle: "Tab"}
				item.SetIALAttr("id", item.ID)
				item.AppendChild(treenode.NewParagraph(ast.NewNodeID()))
				tabs.AppendChild(item)
			}
			selectedID := tabs.LastChild.ID
			tabs.SetIALAttr(treenode.TabsActiveIDAttr, selectedID)
			tree.Root.AppendChild(tabs)
			tableTree, _, _, _ := parseStdMd([]byte("| Header |\n| --- |\n| Cell |"), true)
			table := tableTree.Root.FirstChild
			cells := table.ChildrenByType(ast.NodeTableCell)
			cell := cells[len(cells)-1]
			cell.TableCellRich = &ast.TableCellRich{Spec: 1, Format: "kramdown", Content: "((" + oldChildID + " 'self')) `" + oldChildID + "`"}
			tree.Root.AppendChild(table)
			if err = treenode.RefreshTableCellRichProjection(tree.Root); err != nil {
				t.Fatal(err)
			}
			if _, err = filesys.WriteTree(tree); err != nil {
				t.Fatal(err)
			}
			treenode.UpsertBlockTree(tree)
			originalWorkspace := util.WorkspaceDir
			util.WorkspaceDir = filepath.Dir(util.HistoryDir)
			t.Cleanup(func() { util.WorkspaceDir = originalWorkspace })
			docPath := filepath.Join(util.DataDir, tree.Box, tree.Path)
			snapshot, err := os.ReadFile(docPath)
			if err != nil {
				t.Fatal(err)
			}
			historyPath := filepath.Join(util.HistoryDir, "2026-10-26-120000-update", tree.Box, tree.ID+".sy")
			if err = os.MkdirAll(filepath.Dir(historyPath), 0755); err != nil {
				t.Fatal(err)
			}
			if err = os.WriteFile(historyPath, snapshot, 0600); err != nil {
				t.Fatal(err)
			}
			if scenario != "existing" {
				if err = os.Remove(docPath); err != nil {
					t.Fatal(err)
				}
				treenode.RemoveBlockTreesByRootID(tree.Box, tree.ID)
			}
			conflict, err := LoadTreeByBlockID(fixture.targetID)
			if err != nil {
				t.Fatal(err)
			}
			conflict.Root.FirstChild.ID = oldChildID
			conflict.Root.FirstChild.SetIALAttr("id", oldChildID)
			if scenario == "root-as-body" {
				conflict.Root.FirstChild.ID = tree.ID
				conflict.Root.FirstChild.SetIALAttr("id", tree.ID)
			} else if scenario == "foreign-root" {
				box := &Box{ID: ast.NewNodeID()}
				if err = box.SaveConf(conf.NewBoxConf()); err != nil {
					t.Fatal(err)
				}
				conflict = treenode.NewTree(box.ID, "/"+tree.ID+".sy", "/Foreign", "Foreign")
				conflict.Root.FirstChild.ID = oldChildID
				conflict.Root.FirstChild.SetIALAttr("id", oldChildID)
			}
			conflict.Root.AppendChild(treenode.NewParagraph(selectedID))
			if _, err = filesys.WriteTree(conflict); err != nil {
				t.Fatal(err)
			}
			treenode.UpsertBlockTree(conflict)
			conflictPath := filepath.Join(util.DataDir, conflict.Box, conflict.Path)
			conflictBefore, err := os.ReadFile(conflictPath)
			if err != nil {
				t.Fatal(err)
			}
			relative, err := filepath.Rel(util.WorkspaceDir, historyPath)
			if err != nil {
				t.Fatal(err)
			}
			if err = RollbackDocHistory(relative); err != nil {
				t.Fatal(err)
			}
			restoredBT := treenode.GetBlockTreeRootByHPath(tree.Box, tree.HPath)
			if restoredBT == nil {
				t.Fatal("restored document is not indexed")
			}
			restored, err := filesys.LoadTree(tree.Box, restoredBT.Path, util.NewLute())
			if err != nil {
				t.Fatal(err)
			}
			paragraph := restored.Root.FirstChild
			refs := paragraph.ChildrenByType(ast.NodeTextMark)
			for i, want := range []string{paragraph.ID, restored.ID, fixture.targetID} {
				if refs[i].TextMarkBlockRefID != want {
					t.Errorf("reference %d targets %s, want %s", i, refs[i].TextMarkBlockRefID, want)
				}
			}
			if refs[3].TextMarkAHref != "siyuan://blocks/"+paragraph.ID+"?focus=1#anchor" || paragraph.LastChild.TokensStr() != oldChildID {
				t.Fatal("block link or literal text was changed incorrectly")
			}
			if restored.Root.ChildrenByType(ast.NodeBlockQueryEmbedScript)[0].TokensStr() != "select * from blocks where id='"+paragraph.ID+"'" {
				t.Fatal("embedded query retained a conflicting ID")
			}
			var richRef string
			ast.Walk(restored.Root.LastChild, func(n *ast.Node, entering bool) ast.WalkStatus {
				if entering && treenode.IsBlockRef(n) {
					richRef = n.TextMarkBlockRefID
				}
				return ast.WalkContinue
			})
			if richRef != paragraph.ID {
				t.Fatal("rich table reference retained a conflicting ID")
			}
			restoredTabs := restored.Root.ChildrenByType(ast.NodeTabs)[0]
			if active := restoredTabs.IALAttr(treenode.TabsActiveIDAttr); active != restoredTabs.LastChild.ID || active == selectedID {
				t.Fatal("selected tab did not follow its remapped ID")
			}
			if data, err := os.ReadFile(conflictPath); err != nil || !bytes.Equal(data, conflictBefore) {
				t.Fatal("restoration changed the document that owns the conflicting ID")
			}
			if data, err := os.ReadFile(historyPath); err != nil || !bytes.Equal(data, snapshot) {
				t.Fatal("restoration changed source history")
			}
		})
	}
}

func TestRestoreDocumentHistoryInvalidatesUndoRedoOnlyAfterWrite(t *testing.T) {
	for _, fail := range []bool{false, true} {
		t.Run(map[bool]string{false: "success", true: "write-failure"}[fail], func(t *testing.T) {
			fixture := setupStructureTransactionTest(t)
			setupFoldTransactionDatabase(t, fixture)
			tree, err := LoadTreeByBlockID(fixture.sourceID)
			if err != nil {
				t.Fatal(err)
			}
			originalWorkspace := util.WorkspaceDir
			util.WorkspaceDir = filepath.Dir(util.HistoryDir)
			t.Cleanup(func() { util.WorkspaceDir = originalWorkspace })
			historyPath := filepath.Join(util.HistoryDir, "2026-10-26-100000-update", tree.Box, tree.ID+".sy")
			if err = os.MkdirAll(filepath.Dir(historyPath), 0755); err != nil {
				t.Fatal(err)
			}
			docPath := filepath.Join(util.DataDir, tree.Box, tree.Path)
			historical, err := os.ReadFile(docPath)
			if err != nil {
				t.Fatal(err)
			}
			if err = os.WriteFile(historyPath, historical, 0600); err != nil {
				t.Fatal(err)
			}
			tree.Root.FirstChild.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("new content")})
			if _, err = filesys.WriteTree(tree); err != nil {
				t.Fatal(err)
			}
			seedDocumentHistory(t, fixture.sourceID, fixture.targetID)
			if fail {
				if err = os.Remove(docPath); err != nil {
					t.Fatal(err)
				}
				if err = os.Mkdir(docPath, 0755); err != nil {
					t.Fatal(err)
				}
				if err = os.WriteFile(filepath.Join(docPath, "blocked"), []byte("preserved"), 0600); err != nil {
					t.Fatal(err)
				}
			}
			relative, relErr := filepath.Rel(util.WorkspaceDir, historyPath)
			if relErr != nil {
				t.Fatal(relErr)
			}
			if fail {
				err = RollbackDocHistory(relative)
			} else {
				provider := filesys.DEKProvider
				defer func() { filesys.DEKProvider = provider }()
				started, allowWrite := make(chan struct{}), make(chan struct{})
				var once, release sync.Once
				defer release.Do(func() { close(allowWrite) })
				filesys.DEKProvider = func(id string) ([]byte, error) {
					once.Do(func() {
						close(started)
						<-allowWrite
					})
					return provider(id)
				}
				restored := make(chan error, 1)
				go func() { restored <- RollbackDocHistory(relative) }()
				select {
				case <-started:
				case <-time.After(5 * time.Second):
					t.Fatal("restore did not reach its write boundary")
				}
				history := make(chan bool, 1)
				go func() {
					history <- WithTransactionHistory(func(_ func(*Transaction) error) bool {
						undo, redo, _ := GlobalUndoLog.State(fixture.sourceID)
						return undo || redo
					})
				}()
				select {
				case <-history:
					t.Fatal("history selection entered before restoration finished")
				case <-time.After(20 * time.Millisecond):
				}
				release.Do(func() { close(allowWrite) })
				select {
				case err = <-restored:
				case <-time.After(5 * time.Second):
					t.Fatal("restore did not finish")
				}
				select {
				case stale := <-history:
					if stale {
						t.Fatal("history selection retained pre-restoration operations")
					}
				case <-time.After(5 * time.Second):
					t.Fatal("history selection did not resume after restore")
				}
			}
			if fail {
				if err == nil || strings.Contains(err.Error(), "history path") {
					t.Fatal("expected restore write failure")
				}
				if undo, redo, _ := GlobalUndoLog.State(fixture.sourceID); !undo || !redo {
					t.Fatal("failed restore discarded working history")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			requireDocumentHistoryCleared(t, fixture.sourceID, fixture.targetID)
			cache.RemoveTreeData(tree.ID)
			restored, loadErr := os.ReadFile(docPath)
			if loadErr != nil || !bytes.Equal(restored, historical) {
				t.Fatalf("restore did not preserve historical document: %v", loadErr)
			}
		})
	}
}

func requireDocumentHistoryCleared(t *testing.T, changed, unrelated string) {
	t.Helper()
	if canUndo, canRedo, _ := GlobalUndoLog.State(changed); canUndo || canRedo {
		t.Fatal("rewritten document retained stale undo or redo")
	}
	if canUndo, canRedo, _ := GlobalUndoLog.State(unrelated); !canUndo || !canRedo {
		t.Fatal("unrelated document lost history")
	}
}

func TestBatchDocumentWritesInvalidateHistory(t *testing.T) {
	for _, action := range []string{"replace", "format", "network-assets", "network-no-change"} {
		t.Run(action, func(t *testing.T) {
			fixture := setupStructureTransactionTest(t)
			setupFoldTransactionDatabase(t, fixture)
			Conf.Search.Store(conf.NewSearch())
			tree, err := LoadTreeByBlockID(fixture.sourceID)
			if err != nil {
				t.Fatal(err)
			}
			paragraph := tree.Root.FirstChild
			paragraph.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("FOO")})
			if action == "network-assets" {
				server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					w.Header().Set("Content-Type", "image/png")
					w.Write([]byte("image data"))
				}))
				defer server.Close()
				paragraph.AppendChild(&ast.Node{Type: ast.NodeTextMark, TextMarkType: "a",
					TextMarkAHref: server.URL + "/image.png", TextMarkTextContent: "image"})
			}
			if _, err = filesys.WriteTree(tree); err != nil {
				t.Fatal(err)
			}
			treenode.UpsertBlockTree(tree)
			seedDocumentHistory(t, fixture.sourceID, fixture.targetID)
			switch action {
			case "replace":
				err = FindReplaceInBox("FOO", "BAR", map[string]bool{"text": true}, []string{paragraph.ID}, nil, nil, nil, nil, 0, "")
			case "format":
				err = AutoSpace(fixture.sourceID)
			default:
				assetsDir := filepath.Join(util.DataDir, "assets")
				if err = os.MkdirAll(assetsDir, 0755); err != nil {
					t.Fatal(err)
				}
				err = netAssets2LocalAssets0(tree, false, "", assetsDir, true)
			}
			if err != nil {
				t.Fatal(err)
			}
			if action == "network-no-change" {
				if canUndo, canRedo, _ := GlobalUndoLog.State(fixture.sourceID); !canUndo || !canRedo {
					t.Fatal("operation without a document write cleared history")
				}
			} else {
				requireDocumentHistoryCleared(t, fixture.sourceID, fixture.targetID)
			}
		})
	}
}
