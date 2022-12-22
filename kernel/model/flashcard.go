// SiYuan - Build Your Eternal Digital Garden
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

package model

import (
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/riff"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var Decks = map[string]*riff.Deck{}
var deckLock = sync.Mutex{}

func ReviewFlashcard(deckID string, blockID string, rating riff.Rating) (err error) {
	deckLock.Lock()
	deck := Decks[deckID]
	deckLock.Unlock()

	deck.Review(blockID, rating)
	err = deck.Save()
	if nil != err {
		logging.LogErrorf("save deck [%s] failed: %s", deckID, err)
		return
	}
	return
}

func GetDueFlashcards(deckID string) (ret []string, err error) {
	if "" == deckID {
		return getAllDueFlashcards()
	}

	deckLock.Lock()
	deck := Decks[deckID]
	deckLock.Unlock()

	cards := deck.Dues()
	for _, card := range cards {
		blockID := card.BlockID()
		_, getErr := GetBlock(blockID)
		if nil != getErr {
			continue
		}
		ret = append(ret, blockID)
	}
	return
}

func getAllDueFlashcards() (ret []string, err error) {
	blockIDs := map[string]bool{}
	for _, deck := range Decks {
		cards := deck.Dues()
		for _, card := range cards {
			blockID := card.BlockID()
			_, getErr := GetBlock(blockID)
			if nil != getErr {
				continue
			}

			if blockIDs[blockID] {
				continue
			}

			ret = append(ret, blockID)
			blockIDs[blockID] = true
		}
	}
	return
}

func RemoveFlashcards(deckID string, blockIDs []string) (err error) {
	deckLock.Lock()
	deck := Decks[deckID]
	deckLock.Unlock()

	for _, blockID := range blockIDs {
		deck.RemoveCard(blockID)
	}
	err = deck.Save()
	if nil != err {
		logging.LogErrorf("save deck [%s] failed: %s", deckID, err)
		return
	}
	return
}

func AddFlashcards(deckID string, blockIDs []string) (err error) {
	deckLock.Lock()
	deck := Decks[deckID]
	deckLock.Unlock()

	for _, blockID := range blockIDs {
		cardID := ast.NewNodeID()
		deck.AddCard(cardID, blockID)
	}
	err = deck.Save()
	if nil != err {
		logging.LogErrorf("save deck [%s] failed: %s", deckID, err)
		return
	}
	return
}

func InitFlashcards() {
	riffSavePath := getRiffDir()
	if err := os.MkdirAll(riffSavePath, 0755); nil != err {
		logging.LogErrorf("create riff dir [%s] failed: %s", riffSavePath, err)
		return
	}

	entries, err := os.ReadDir(riffSavePath)
	if nil != err {
		logging.LogErrorf("read riff dir failed: %s", err)
		return
	}
	for _, entry := range entries {
		name := entry.Name()
		if strings.HasSuffix(name, ".deck") {
			deckID := strings.TrimSuffix(name, ".deck")
			deck, loadErr := riff.LoadDeck(riffSavePath, deckID)
			if nil != loadErr {
				logging.LogErrorf("load deck [%s] failed: %s", name, loadErr)
				continue
			}

			Decks[deckID] = deck
		}
	}

	if 1 > len(Decks) {
		deck, createErr := CreateDeck("Default Deck")
		if nil == createErr {
			Decks[deck.ID] = deck
		}
	}
}

func RenameDeck(deckID string, name string) (err error) {
	deckLock.Lock()
	deck := Decks[deckID]
	deckLock.Unlock()

	deck.Name = name
	err = deck.Save()
	if nil != err {
		logging.LogErrorf("save deck [%s] failed: %s", deckID, err)
		return
	}
	return
}

func CreateDeck(name string) (deck *riff.Deck, err error) {
	riffSavePath := getRiffDir()
	deckID := ast.NewNodeID()
	deck, err = riff.LoadDeck(riffSavePath, deckID)
	if nil != err {
		logging.LogErrorf("load deck [%s] failed: %s", deckID, err)
		return
	}
	deck.Name = name

	deckLock.Lock()
	Decks[deckID] = deck
	deckLock.Unlock()
	return
}

func GetDecks() (decks []*riff.Deck) {
	deckLock.Lock()
	defer deckLock.Unlock()

	for _, deck := range Decks {
		decks = append(decks, deck)
	}
	if 1 > len(decks) {
		decks = []*riff.Deck{}
	}
	return
}

func getRiffDir() string {
	return filepath.Join(util.DataDir, "storage", "riff")
}
