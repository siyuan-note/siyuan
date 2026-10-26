//go:build fts5

package model

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

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
			err = RollbackDocHistory(relative)
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
