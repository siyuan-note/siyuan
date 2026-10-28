// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/riff"
	"github.com/siyuan-note/siyuan/kernel/util"
)

type flashcardDeckBefore struct {
	deck    *riff.Deck
	cards   []riff.Card
	updated int64
}

func (tx *Transaction) lockFlashcardMutation() {
	if !tx.flashcardLocked {
		deckLock.Lock()
		tx.flashcardLocked = true
	}
}

func (tx *Transaction) rememberFlashcardDeck(id string) error {
	if !ast.IsNodeIDPattern(id) {
		return errors.New("invalid deck ID")
	}
	if tx.flashcardBefore == nil {
		tx.flashcardBefore = map[string]*flashcardDeckBefore{}
	}
	if tx.flashcardBefore[id] != nil {
		return nil
	}
	before := &flashcardDeckBefore{deck: Decks[id]}
	if before.deck != nil {
		before.updated = before.deck.Updated
		for _, card := range before.deck.GetCardsByBlockIDs(before.deck.GetBlockIDs()) {
			before.cards = append(before.cards, card.Clone())
		}
	}
	var files []*documentSourceFile
	for _, extension := range []string{".cards", ".deck"} {
		path := "/storage/riff/" + id + extension
		data, err := os.ReadFile(filepath.Join(getRiffDir(), id+extension))
		if os.IsNotExist(err) {
			data, err = nil, nil
		}
		if err != nil {
			return err
		}
		files = append(files, &documentSourceFile{Kind: "flashcard", Path: path, Before: data, After: data})
	}
	if tx.sourceJournal == nil {
		tx.sourceJournal = &documentSourceJournal{Version: 1, ID: ast.NewNodeID(), State: "pending"}
	}
	tx.sourceJournal.Forward = false
	tx.sourceJournal.Files = append(tx.sourceJournal.Files, files...)
	if err := tx.sourceJournal.save(); err != nil {
		return err
	}
	tx.flashcardBefore[id] = before
	return nil
}

func (tx *Transaction) saveFlashcardDeck(deck *riff.Deck) error {
	if err := tx.rememberFlashcardDeck(deck.ID); err != nil {
		return err
	}
	return deck.SaveWithWriter(func(name string, data []byte) error {
		for _, file := range tx.sourceJournal.Files {
			if file.Kind != "flashcard" {
				continue
			}
			path, err := file.filename()
			if err != nil {
				return err
			}
			if filepath.Clean(path) != filepath.Clean(name) {
				continue
			}
			previous := file.After
			file.After = bytes.Clone(data)
			if err := tx.sourceJournal.save(); err != nil {
				return err
			}
			write := tx.writeFlashcardFile
			if write == nil {
				write = util.WriteFileIfUnchanged
			}
			return write(name, previous, data)
		}
		return errors.New("unregistered flashcard source file")
	})
}

func (tx *Transaction) finishFlashcardMutation(rollback bool) {
	if rollback {
		for id, before := range tx.flashcardBefore {
			if before.deck == nil {
				delete(Decks, id)
				continue
			}
			deck := before.deck
			for _, card := range deck.GetCardsByBlockIDs(deck.GetBlockIDs()) {
				deck.RemoveCard(card.ID())
			}
			for _, card := range before.cards {
				deck.SetCard(card)
			}
			deck.Updated = before.updated
			Decks[id] = deck
		}
	}
	tx.flashcardBefore = nil
	tx.writeFlashcardFile = nil
	if tx.flashcardLocked {
		tx.flashcardLocked = false
		deckLock.Unlock()
	}
}
