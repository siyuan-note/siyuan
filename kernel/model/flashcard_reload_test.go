// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"testing"

	"github.com/siyuan-note/riff"
	"github.com/siyuan-note/siyuan/kernel/conf"
)

func TestFlashcardReloadInvalidatesReviewState(t *testing.T) {
	fixture := setupFileOperationTest(t)
	Conf.Flashcard.Store(conf.NewFlashcard())
	previousDecks, previousReviews, previousSkipped := Decks, reviewCardCache, skipCardCache
	Decks = map[string]*riff.Deck{}
	t.Cleanup(func() { Decks, reviewCardCache, skipCardCache = previousDecks, previousReviews, previousSkipped })
	deck, err := createDeck0("reload", builtinDeckID)
	if err != nil {
		t.Fatal(err)
	}
	const cardID = "20261027000000-abcdefg"
	deck.AddCard(cardID, fixture.sourceID)
	oldCard := deck.GetCard(cardID).Clone()
	reviewCardCache = map[string]riff.Card{cardID: oldCard}
	skipCardCache = map[string]riff.Card{cardID: oldCard}
	// Represent a newer schedule arriving on disk while the old review UI lives on.
	deck.Review(cardID, riff.Rating(3))
	if err := deck.Save(); err != nil {
		t.Fatal(err)
	}
	reps := deck.GetCard(cardID).GetReps()
	LoadFlashcards()
	if len(reviewCardCache) != 0 || len(skipCardCache) != 0 {
		t.Fatal("deck reload retained undo or skip state from the old generation")
	}
	if got := Decks[deck.ID].GetCard(cardID).GetReps(); got != reps {
		t.Fatalf("reload changed persisted schedule: %d, want %d", got, reps)
	}
	if err := ReviewFlashcard(deck.ID, cardID, riff.Rating(3), []string{cardID}); err != nil {
		t.Fatal(err)
	}
	if got := Decks[deck.ID].GetCard(cardID).GetReps(); got != reps+1 {
		t.Fatalf("continued review restored an old schedule: %d, want %d", got, reps+1)
	}
}
