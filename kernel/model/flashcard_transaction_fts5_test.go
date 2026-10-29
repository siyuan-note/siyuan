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
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/riff"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestFlashcardTransactionFailureRestoresSources(t *testing.T) {
	for _, action := range []string{"addFlashcards", "removeFlashcards"} {
		for _, failure := range []string{"", ".cards", ".deck", "document", "later operation"} {
			t.Run(action+"/"+failure, func(t *testing.T) {
				fixture := setupStructureTransactionTest(t)
				setupFoldTransactionDatabase(t, fixture)
				Conf.Flashcard.Store(conf.NewFlashcard())
				previous := Decks
				Decks = map[string]*riff.Deck{}
				t.Cleanup(func() { Decks = previous })
				deck, err := createDeck0("transaction", builtinDeckID)
				if err != nil {
					t.Fatal(err)
				}
				const cardID = "20261027000000-abcdefg"
				if action == "removeFlashcards" {
					deck.AddCard(cardID, fixture.childID)
					deck.Review(cardID, riff.Rating(3))
					if err := deck.Save(); err != nil {
						t.Fatal(err)
					}
					tree, err := LoadTreeByBlockID(fixture.childID)
					if err != nil {
						t.Fatal(err)
					}
					treenode.GetNodeInTree(tree, fixture.childID).SetIALAttr(NodeAttrRiffDecks, deck.ID)
					if _, err := filesys.WriteTree(tree); err != nil {
						t.Fatal(err)
					}
				}
				paths := []string{filepath.Join(util.DataDir, fixture.box.ID, fixture.sourcePath), filepath.Join(getRiffDir(), deck.ID+".cards"), filepath.Join(getRiffDir(), deck.ID+".deck")}
				before := map[string][]byte{}
				for _, path := range paths {
					before[path], err = os.ReadFile(path)
					if err != nil {
						t.Fatal(err)
					}
				}
				tx := &Transaction{DoOperations: []*Operation{{Action: action, DeckID: deck.ID, BlockIDs: []string{fixture.childID}}}}
				if failure == "" {
					// Multiple mutations of a deck still publish each source only once.
					tx.DoOperations = append(tx.DoOperations, &Operation{Action: action, DeckID: deck.ID, BlockIDs: []string{fixture.childID}})
				}
				injected := errors.New("injected " + failure + " failure")
				writes := 0
				tx.writeFlashcardFile = func(path string, original, data []byte) error {
					writes++
					if failure != "" && strings.HasSuffix(path, failure) {
						return injected
					}
					return util.WriteFileIfUnchanged(path, original, data)
				}
				if failure == "document" {
					tx.writeTransactionTree = func(*parse.Tree) error { return injected }
				} else if failure == "later operation" {
					tx.DoOperations = append(tx.DoOperations, &Operation{Action: "setAttrs", ID: ast.NewNodeID(), Data: `{"custom-state":"active"}`})
				}
				err = PerformTxSync(tx)
				if failure == "" {
					if err != nil || writes != 2 {
						t.Fatalf("successful transaction did not save both sources: %v, %d", err, writes)
					}
					want := 1
					if action == "removeFlashcards" {
						want = 0
					}
					if deck.CountCards() != want {
						t.Fatalf("mutation was not committed: %d, want %d", deck.CountCards(), want)
					}
					loaded, loadErr := riff.LoadDeck(getRiffDir(), deck.ID, Conf.Flashcard.Load().RequestRetention, Conf.Flashcard.Load().MaximumInterval, Conf.Flashcard.Load().Weights)
					if loadErr != nil || loaded.CountCards() != want {
						t.Fatalf("committed deck did not persist: %v", loadErr)
					}
					return
				}
				if err == nil {
					t.Fatal("transaction failure was reported as success")
				}
				if tx.sourceRollbackErr != nil {
					t.Fatalf("source compensation failed: %v", tx.sourceRollbackErr)
				}
				for path, original := range before {
					if data, err := os.ReadFile(path); err != nil || !bytes.Equal(data, original) {
						t.Fatalf("failed transaction changed %s: %v", path, err)
					}
				}
				if action == "removeFlashcards" {
					if card := deck.GetCard(cardID); card == nil || card.GetReps() != 1 {
						t.Fatalf("rollback lost the original card schedule: %v", card)
					}
				} else if deck.CountCards() != 0 {
					t.Fatal("failed addition remained in memory")
				}
				if !deckLock.TryLock() {
					t.Fatal("transaction retained the deck mutation lock")
				}
				deckLock.Unlock()
			})
		}
	}
}

func TestFlashcardSourceRecoveryPreservesPreviousFormat(t *testing.T) {
	setupFileOperationTest(t)
	Conf.Flashcard.Store(conf.NewFlashcard())
	previous := Decks
	Decks = map[string]*riff.Deck{}
	t.Cleanup(func() { Decks = previous })
	deck, err := createDeck0("recovery", builtinDeckID)
	if err != nil {
		t.Fatal(err)
	}
	journal := &documentSourceJournal{Version: 1, ID: ast.NewNodeID(), State: "pending"}
	for _, extension := range []string{".cards", ".deck"} {
		data, err := os.ReadFile(filepath.Join(getRiffDir(), deck.ID+extension))
		if err != nil {
			t.Fatal(err)
		}
		journal.Files = append(journal.Files, &documentSourceFile{Kind: "flashcard", Path: "/storage/riff/" + deck.ID + extension, Before: data, After: data})
	}
	deck.AddCard("20261027000000-abcdefg", "20261027000001-abcdefg")
	if err := deck.SaveWithWriter(func(path string, data []byte) error {
		for _, file := range journal.Files {
			if filepath.Base(file.Path) == filepath.Base(path) {
				file.After = data
			}
		}
		if err := journal.save(); err != nil {
			return err
		}
		// Simulate interruption after cards have changed, before the deck write.
		if strings.HasSuffix(path, ".deck") {
			return errors.New("interrupted")
		}
		return os.WriteFile(path, data, 0600)
	}); err == nil {
		t.Fatal("expected simulated interruption")
	}
	if err := recoverDocumentSources(); err != nil {
		t.Fatal(err)
	}
	LoadFlashcards()
	if Decks[deck.ID] == nil || Decks[deck.ID].CountCards() != 0 {
		t.Fatal("recovery did not restore the previous deck representation")
	}
}

func TestFlashcardTransactionFailedBuiltinCreation(t *testing.T) {
	fixture := setupStructureTransactionTest(t)
	setupFoldTransactionDatabase(t, fixture)
	Conf.Flashcard.Store(conf.NewFlashcard())
	previous := Decks
	Decks = map[string]*riff.Deck{}
	t.Cleanup(func() { Decks = previous })
	tx := &Transaction{DoOperations: []*Operation{{Action: "addFlashcards", DeckID: builtinDeckID, BlockIDs: []string{fixture.childID}}}}
	tx.writeFlashcardFile = func(path string, original, data []byte) error {
		if strings.HasSuffix(path, ".deck") {
			return errors.New("injected builtin deck save failure")
		}
		return util.WriteFileIfUnchanged(path, original, data)
	}
	if err := PerformTxSync(tx); err == nil || tx.sourceRollbackErr != nil {
		t.Fatalf("builtin creation did not roll back: %v, %v", err, tx.sourceRollbackErr)
	}
	if Decks[builtinDeckID] != nil {
		t.Fatal("failed builtin deck remained in memory")
	}
	for _, extension := range []string{".cards", ".deck"} {
		if _, err := os.Stat(filepath.Join(getRiffDir(), builtinDeckID+extension)); !os.IsNotExist(err) {
			t.Fatalf("failed builtin creation retained %s: %v", extension, err)
		}
	}
}
