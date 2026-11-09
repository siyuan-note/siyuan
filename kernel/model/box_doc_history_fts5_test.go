// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5

package model

import (
	"bytes"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
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

type notebookHistoryTitleFixture struct {
	box                         *Box
	tree                        *parse.Tree
	doc, config, history, input string
	currentDoc, currentConfig   []byte
	historyBytes                []byte
	backups                     map[string][]byte
}

func newNotebookHistoryTitleBox(t *testing.T) string {
	t.Helper()
	box := &Box{ID: ast.NewNodeID()}
	configuration := conf.NewBoxConf()
	configuration.Name, configuration.Closed = "Legacy notebook", false
	if err := box.SaveConf(configuration); err != nil {
		t.Fatal(err)
	}
	if _, err := Mount(box.ID); err != nil {
		t.Fatal(err)
	}
	return box.ID
}

func setupNotebookHistoryTitle(t *testing.T, boxID string, rich bool) *notebookHistoryTitleFixture {
	t.Helper()
	Conf.FileTree.Load().BoxDocEnabled = true
	if _, err := EnsureBoxDoc(boxID); err != nil {
		t.Fatal(err)
	}
	initial, err := filesys.LoadTree(boxID, boxDocPath(boxID), util.NewLute())
	if err != nil {
		t.Fatal(err)
	}
	initial.Root.FirstChild.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("Historical body")})
	if err = indexWriteTreeUpsertQueue(initial); err != nil {
		t.Fatal(err)
	}
	sql.FlushQueue()
	f := &notebookHistoryTitleFixture{box: Conf.Box(boxID),
		doc:    filepath.Join(util.DataDir, boxID, boxID+".sy"),
		config: filepath.Join(util.DataDir, boxID, ".siyuan", "conf.json"), backups: map[string][]byte{}}
	write := func(text string) {
		current, err := GetDocTitle(boxID, boxID)
		if err != nil {
			t.Fatal(err)
		}
		if err = PerformTxSync(&Transaction{DoOperations: []*Operation{{Action: "setDocTitle", ID: boxID,
			Data: map[string]any{"blockDOM": util.NewLute().Md2BlockDOM("**"+text+"**", false),
				"expectedRevision": current.Revision}}}}); err != nil {
			t.Fatal(err)
		}
		sql.FlushQueue()
	}
	if rich {
		write("Historical notebook / title")
	}
	f.tree, _, err = filesys.LoadTreeSnapshot(boxID, boxDocPath(boxID), util.NewLute())
	if err != nil {
		t.Fatal(err)
	}
	if !rich && (f.tree.Root.DocumentTitle != nil || f.tree.Root.IALAttr(boxDocTitleSourceAttr) != "") {
		t.Fatal("legacy fixture already has a document-authoritative title")
	}
	historyDir := filepath.Join(util.HistoryDir, "2026-11-07-050000-update")
	if err = generateDocHistoryFile(boxID, f.doc, historyDir, util.NewLute()); err != nil {
		t.Fatal(err)
	}
	f.history = filepath.Join(historyDir, boxID, boxID+".sy")
	f.historyBytes = notebookHistoryTitleBytes(t, f.history)
	f.input, err = filepath.Rel(util.WorkspaceDir, f.history)
	if err != nil {
		t.Fatal(err)
	}
	write("Current notebook title")
	fields := notebookHistoryTitleFields(t, notebookHistoryTitleBytes(t, f.config))
	fields["futureSetting"] = json.RawMessage(`{"enabled":true,"values":[1,2,3]}`)
	data, err := json.MarshalIndent(fields, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(f.config, data, 0600); err != nil {
		t.Fatal(err)
	}
	f.currentDoc, f.currentConfig = notebookHistoryTitleBytes(t, f.doc), data
	f.box = Conf.Box(boxID)
	if IsEncryptedBox(boxID) {
		for _, filename := range []string{dataCryptoBackupPath(),
			filepath.Join(util.DataDir, boxID, ".siyuan", notebookCryptoBackupFilename)} {
			f.backups[filename] = notebookHistoryTitleBytes(t, filename)
		}
	}
	return f
}

func notebookHistoryTitleBytes(t *testing.T, filename string) []byte {
	t.Helper()
	data, err := os.ReadFile(filename)
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func notebookHistoryTitleFields(t *testing.T, data []byte) map[string]json.RawMessage {
	t.Helper()
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil {
		t.Fatal(err)
	}
	return fields
}

func (f *notebookHistoryTitleFixture) checkPreserved(t *testing.T) {
	t.Helper()
	if !bytes.Equal(f.historyBytes, notebookHistoryTitleBytes(t, f.history)) {
		t.Fatal("history snapshot was modified")
	}
	for filename, expected := range f.backups {
		if !bytes.Equal(expected, notebookHistoryTitleBytes(t, filename)) {
			t.Fatalf("cryptographic backup was modified: %s", filename)
		}
	}
	if util.IsCiphertext(notebookHistoryTitleBytes(t, f.doc)) != IsEncryptedBox(f.box.ID) {
		t.Fatal("notebook document crossed its encryption boundary")
	}
}

func TestNotebookDocumentHistoryTitle(t *testing.T) {
	if !documentTitleTestProcess(t) {
		return
	}
	prepareHPathRefreshTest(t)
	t.Cleanup(backgroundRefreshWaitGroup.Wait)
	Conf.Flashcard.Store(conf.NewFlashcard())
	testNotebookDocumentHistoryTitle(t, newNotebookHistoryTitleBox)
}

func testNotebookDocumentHistoryTitle(t *testing.T, newBox func(*testing.T) string) {
	for _, rich := range []bool{false, true} {
		t.Run(map[bool]string{false: "legacy", true: "rich"}[rich], func(t *testing.T) {
			f := setupNotebookHistoryTitle(t, newBox(t), rich)
			staleConfig := f.box.GetConf()
			if err := RollbackDocHistory(f.input); err != nil {
				t.Fatal(err)
			}
			backgroundRefreshWaitGroup.Wait()
			sql.FlushQueue()
			check := func() {
				t.Helper()
				tree, _, err := filesys.LoadTreeSnapshot(f.box.ID, f.tree.Path, util.NewLute())
				if err != nil {
					t.Fatal(err)
				}
				if tree.ID != f.tree.ID || treenode.DocumentTitleRevision(tree.Root) != treenode.DocumentTitleRevision(f.tree.Root) ||
					!reflect.DeepEqual(tree.Root.DocumentTitle, f.tree.Root.DocumentTitle) ||
					tree.Root.FirstChild.ID != f.tree.Root.FirstChild.ID || tree.Root.IALAttr(boxDocTitleSourceAttr) != "document" {
					t.Fatal("restoration changed the historical title source, body or authority")
				}
				name := treenode.ReadDocumentTitle(f.tree.Root).Text
				if f.box.GetConf().Name != name || Conf.Box(f.box.ID).Name != name {
					t.Fatalf("restored name is inconsistent: config=%q runtime=%q expected=%q", f.box.GetConf().Name, Conf.Box(f.box.ID).Name, name)
				}
			}
			check()
			before, after := notebookHistoryTitleFields(t, f.currentConfig), notebookHistoryTitleFields(t, notebookHistoryTitleBytes(t, f.config))
			delete(before, "name")
			delete(after, "name")
			var beforeValue, afterValue any
			beforeJSON, _ := json.Marshal(before)
			afterJSON, _ := json.Marshal(after)
			json.Unmarshal(beforeJSON, &beforeValue)
			json.Unmarshal(afterJSON, &afterValue)
			if !reflect.DeepEqual(beforeValue, afterValue) {
				t.Fatal("history restoration changed unrelated or encrypted configuration fields")
			}
			f.checkPreserved(t)
			staleConfig.SortMode = 7
			if err := f.box.SaveConfAndSync(staleConfig); err != nil {
				t.Fatal(err)
			}
			if _, err := EnsureBoxDoc(f.box.ID); err != nil {
				t.Fatal(err)
			}
			check()
			if f.box.GetConf().SortMode != 7 {
				t.Fatal("saving another setting was lost")
			}
			if pending, err := readDocumentSourceJournals(); err != nil || len(pending) != 0 {
				t.Fatalf("successful history restore retained a journal: %v %v", pending, err)
			}
		})
	}
}

func TestNotebookDocumentHistoryTitleRecovery(t *testing.T) {
	if !documentTitleTestProcess(t) {
		return
	}
	prepareHPathRefreshTest(t)
	t.Cleanup(backgroundRefreshWaitGroup.Wait)
	Conf.Flashcard.Store(conf.NewFlashcard())
	testNotebookDocumentHistoryTitleRecovery(t, newNotebookHistoryTitleBox)
}

func TestNotebookDocumentHistoryTitleDynamicReferences(t *testing.T) {
	if !documentTitleTestProcess(t) {
		return
	}
	prepareHPathRefreshTest(t)
	t.Cleanup(backgroundRefreshWaitGroup.Wait)
	Conf.Flashcard.Store(conf.NewFlashcard())
	f := setupNotebookHistoryTitle(t, newNotebookHistoryTitleBox(t), true)
	current, err := filesys.LoadTree(f.box.ID, f.tree.Path, util.NewLute())
	if err != nil {
		t.Fatal(err)
	}
	current.Root.FirstChild.FirstChild.Tokens = []byte("Current body")
	if err = indexWriteTreeUpsertQueue(current); err != nil {
		t.Fatal(err)
	}
	referencingBox := newNotebookHistoryTitleBox(t)
	if _, err = EnsureBoxDoc(referencingBox); err != nil {
		t.Fatal(err)
	}
	referencing, err := filesys.LoadTree(referencingBox, boxDocPath(referencingBox), util.NewLute())
	if err != nil {
		t.Fatal(err)
	}
	title := &ast.Node{Type: ast.NodeParagraph}
	title.AppendChild(&ast.Node{Type: ast.NodeTextMark, TextMarkType: "strong block-ref", TextMarkBlockRefID: current.Root.FirstChild.ID,
		TextMarkBlockRefSubtype: "d", TextMarkTextContent: "Current body"})
	if err = treenode.SetDocumentTitleParagraph(referencing.Root, title); err != nil {
		t.Fatal(err)
	}
	referencing.Root.SetIALAttr(boxDocTitleSourceAttr, "document")
	if err = indexWriteTreeUpsertQueue(referencing); err != nil {
		t.Fatal(err)
	}
	if err = syncBoxDocTitleName(referencing); err != nil {
		t.Fatal(err)
	}
	sql.FlushQueue()
	if refs := sql.QueryRefsByDefIDInBox(current.Root.FirstChild.ID, false, f.box.ID); len(refs) != 1 {
		t.Fatalf("dynamic notebook title reference is not indexed: %+v", refs)
	}
	done := make(chan error, 1)
	go func() { done <- RollbackDocHistory(f.input) }()
	select {
	case err = <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("history restore deadlocked while refreshing a notebook title reference")
	}
	backgroundRefreshWaitGroup.Wait()
	sql.FlushQueue()
	value, err := GetDocTitle(referencingBox, referencingBox)
	if err != nil || !strings.Contains(value.Text, "Historical body") || Conf.Box(referencingBox).GetConf().Name != value.Text {
		t.Fatalf("restoring a definition did not refresh the referencing notebook title: %+v %v", value, err)
	}
}

func testNotebookDocumentHistoryTitleRecovery(t *testing.T, newBox func(*testing.T) string) {
	for _, scenario := range []string{"config failure", "config written failure", "document failure", "journal failure",
		"pending config restart", "pending document restart", "committed restart", "config conflict", "source conflict"} {
		t.Run(scenario, func(t *testing.T) {
			f := setupNotebookHistoryTitle(t, newBox(t), true)
			boxDocTitleNameLock.Lock()
			defer boxDocTitleNameLock.Unlock()
			recovery := newAttributeViewHistoryRecovery()
			tx := &Transaction{trees: map[string]*parse.Tree{}, historyRecovery: recovery}
			failure := errors.New("injected notebook history failure")
			var changedConfig, changedSource []byte
			write := func(boxID string, before, after []byte) error {
				if scenario == "config failure" {
					return failure
				}
				if scenario == "config conflict" {
					changedConfig = append(bytes.Clone(before), '\n')
					if err := os.WriteFile(f.config, changedConfig, 0600); err != nil {
						t.Fatal(err)
					}
				}
				err := writeHistoryNotebookConf(boxID, before, after)
				if err == nil && scenario == "config written failure" {
					return failure
				}
				if err == nil && scenario == "source conflict" {
					current, readErr := filesys.LoadTree(f.box.ID, f.tree.Path, util.NewLute())
					if readErr != nil {
						t.Fatal(readErr)
					}
					current.Root.AppendChild(treenode.NewParagraph("concurrent body edit"))
					if _, readErr = filesys.WriteTree(current); readErr != nil {
						t.Fatal(readErr)
					}
					changedSource = notebookHistoryTitleBytes(t, f.doc)
				}
				return err
			}
			name, result := recovery.writeBoxDocTitleName(f.tree, write)
			if result == nil && scenario != "pending config restart" {
				writeDoc := func() error { return writeHistoryDocument(f.tree, nil, removeIndexRepairSourceIfUnchanged, recovery) }
				if scenario == "document failure" {
					result = filesys.ObserveTreeWrites(f.tree, f.currentDoc, func([]byte) error { return failure }, writeDoc)
				} else {
					result = writeDoc()
				}
			}
			if f.box.Name != "Current notebook title" {
				t.Fatal("runtime notebook name was published before commit")
			}
			if scenario == "journal failure" {
				oldQueue := util.QueueDir
				util.QueueDir = f.doc
				result = recovery.commit()
				util.QueueDir = oldQueue
				if result == nil {
					t.Fatal("journal write failure was accepted")
				}
			} else if scenario == "committed restart" {
				result = recovery.commit()
				if result != nil {
					t.Fatal(result)
				}
			}
			switch scenario {
			case "pending config restart", "pending document restart", "committed restart":
				if result != nil {
					t.Fatal(result)
				}
				if err := recoverDocumentSources(); err != nil {
					t.Fatal(err)
				}
				if err := finishDocumentSourceRecovery(f.box.ID); err != nil {
					t.Fatal(err)
				}
				if scenario == "committed restart" {
					if f.box.GetConf().Name != name {
						t.Fatal("restart discarded the committed notebook name")
					}
					tree, err := filesys.LoadTree(f.box.ID, f.tree.Path, util.NewLute())
					if err != nil || treenode.DocumentTitleRevision(tree.Root) != treenode.DocumentTitleRevision(f.tree.Root) {
						t.Fatalf("restart discarded the committed title: %v", err)
					}
					f.checkPreserved(t)
					return
				}
			case "config conflict", "source conflict":
				if !errors.Is(result, util.ErrFileChanged) {
					t.Fatalf("concurrent source was not rejected: %v", result)
				}
				tx.finishHistoryRecovery(&result)
				if scenario == "config conflict" {
					if !bytes.Equal(changedConfig, notebookHistoryTitleBytes(t, f.config)) ||
						!bytes.Equal(f.currentDoc, notebookHistoryTitleBytes(t, f.doc)) {
						t.Fatal("configuration conflict changed the current source or overwrote concurrent configuration")
					}
				} else {
					if !bytes.Equal(changedSource, notebookHistoryTitleBytes(t, f.doc)) {
						t.Fatal("history recovery overwrote a concurrent document edit")
					}
					if f.box.GetConf().Name != treenode.ReadDocumentTitle(f.tree.Root).Text || f.box.Name != "Current notebook title" {
						t.Fatal("conflicting recovery changed its preserved current configuration or published an uncommitted name")
					}
				}
				if exists, err := archivedDocumentSource(recovery.journal); err != nil || !exists {
					t.Fatalf("conflicting before-images were not archived: %v", err)
				}
				f.checkPreserved(t)
				if err := recoverDocumentSources(); err != nil {
					t.Fatal(err)
				}
				if err := finishDocumentSourceRecovery(f.box.ID); err != nil {
					t.Fatal(err)
				}
				return
			default:
				if result == nil {
					t.Fatal("failed recovery was accepted")
				}
				tx.finishHistoryRecovery(&result)
			}
			if !bytes.Equal(f.currentDoc, notebookHistoryTitleBytes(t, f.doc)) ||
				!bytes.Equal(f.currentConfig, notebookHistoryTitleBytes(t, f.config)) {
				t.Fatalf("failed or interrupted recovery did not restore both exact before-images: %v", result)
			}
			if Conf.Box(f.box.ID).Name != "Current notebook title" {
				t.Fatal("failed or interrupted recovery did not restore the displayed notebook name")
			}
			f.checkPreserved(t)
			if pending, err := readDocumentSourceJournals(); err != nil || len(pending) != 0 {
				t.Fatalf("compensated restore retained a journal: %v %v", pending, err)
			}
		})
	}
}
