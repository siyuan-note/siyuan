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

	"github.com/88250/gulu"
	"github.com/88250/lute"
	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/riff"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var Decks = map[string]*riff.Deck{}
var deckLock = sync.Mutex{}

func RenderFlashcard(blockID string) (content string, err error) {
	tree, err := loadTreeByBlockID(blockID)
	if nil != err {
		return
	}

	node := treenode.GetNodeInTree(tree, blockID)
	if nil == node {
		return
	}

	luteEngine := NewLute()
	luteEngine.RenderOptions.ProtyleContenteditable = false
	if ast.NodeDocument == node.Type {
		content = luteEngine.Tree2BlockDOM(tree, luteEngine.RenderOptions)
	} else {
		content = lute.RenderNodeBlockDOM(node, luteEngine.ParseOptions, luteEngine.RenderOptions)
	}
	return
}

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

type Flashcard struct {
	DeckID  string `json:"deckID"`
	BlockID string `json:"blockID"`
}

func GetDueFlashcards(deckID string) (ret []*Flashcard, err error) {
	if "" == deckID {
		return getAllDueFlashcards()
	}

	deckLock.Lock()
	deck := Decks[deckID]
	deckLock.Unlock()

	cards := deck.Dues()
	for _, card := range cards {
		blockID := card.BlockID()

		if nil == treenode.GetBlockTree(blockID) {
			continue
		}
		ret = append(ret, &Flashcard{
			DeckID:  deckID,
			BlockID: blockID,
		})
	}
	if 1 > len(ret) {
		ret = []*Flashcard{}
	}
	return
}

func getAllDueFlashcards() (ret []*Flashcard, err error) {
	blockIDs := map[string]bool{}
	for _, deck := range Decks {
		cards := deck.Dues()
		for _, card := range cards {
			blockID := card.BlockID()
			if nil == treenode.GetBlockTree(blockID) {
				continue
			}

			if blockIDs[blockID] {
				continue
			}

			ret = append(ret, &Flashcard{
				DeckID:  deck.ID,
				BlockID: blockID,
			})
			blockIDs[blockID] = true
		}
	}
	if 1 > len(ret) {
		ret = []*Flashcard{}
	}
	return
}

func RemoveFlashcards(deckID string, blockIDs []string) (err error) {
	deckLock.Lock()
	deck := Decks[deckID]
	deckLock.Unlock()

	var rootIDs []string
	blockRoots := map[string]string{}
	for _, blockID := range blockIDs {
		bt := treenode.GetBlockTree(blockID)
		if nil == bt {
			continue
		}

		rootIDs = append(rootIDs, bt.RootID)
		blockRoots[blockID] = bt.RootID
	}
	rootIDs = gulu.Str.RemoveDuplicatedElem(rootIDs)

	trees := map[string]*parse.Tree{}
	for _, blockID := range blockIDs {
		rootID := blockRoots[blockID]

		tree := trees[rootID]
		if nil == tree {
			tree, _ = loadTreeByBlockID(blockID)
		}
		if nil == tree {
			continue
		}
		trees[rootID] = tree

		node := treenode.GetNodeInTree(tree, blockID)
		if nil == node {
			continue
		}

		oldAttrs := parse.IAL2Map(node.KramdownIAL)

		deckAttrs := node.IALAttr("custom-riff-decks")
		var deckIDs []string
		for _, dID := range strings.Split(deckAttrs, ",") {
			if dID != deckID {
				deckIDs = append(deckIDs, dID)
			}
		}

		deckIDs = gulu.Str.RemoveDuplicatedElem(deckIDs)
		val := strings.Join(deckIDs, ",")
		val = strings.TrimPrefix(val, ",")
		val = strings.TrimSuffix(val, ",")
		if "" == val {
			node.RemoveIALAttr("custom-riff-decks")
		} else {
			node.SetIALAttr("custom-riff-decks", val)
		}

		if err = indexWriteJSONQueue(tree); nil != err {
			return
		}

		cache.PutBlockIAL(blockID, parse.IAL2Map(node.KramdownIAL))

		newAttrs := parse.IAL2Map(node.KramdownIAL)
		doOp := &Operation{Action: "updateAttrs", Data: map[string]interface{}{"old": oldAttrs, "new": newAttrs}, ID: blockID}
		trans := []*Transaction{{
			DoOperations:   []*Operation{doOp},
			UndoOperations: []*Operation{},
		}}
		pushBroadcastAttrTransactions(trans)
	}

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

	var rootIDs []string
	blockRoots := map[string]string{}
	for _, blockID := range blockIDs {
		bt := treenode.GetBlockTree(blockID)
		if nil == bt {
			continue
		}

		rootIDs = append(rootIDs, bt.RootID)
		blockRoots[blockID] = bt.RootID
	}
	rootIDs = gulu.Str.RemoveDuplicatedElem(rootIDs)

	trees := map[string]*parse.Tree{}
	for _, blockID := range blockIDs {
		rootID := blockRoots[blockID]

		tree := trees[rootID]
		if nil == tree {
			tree, _ = loadTreeByBlockID(blockID)
		}
		if nil == tree {
			continue
		}
		trees[rootID] = tree

		node := treenode.GetNodeInTree(tree, blockID)
		if nil == node {
			continue
		}

		oldAttrs := parse.IAL2Map(node.KramdownIAL)

		deckAttrs := node.IALAttr("custom-riff-decks")
		deckIDs := strings.Split(deckAttrs, ",")
		deckIDs = append(deckIDs, deckID)
		deckIDs = gulu.Str.RemoveDuplicatedElem(deckIDs)
		val := strings.Join(deckIDs, ",")
		val = strings.TrimPrefix(val, ",")
		val = strings.TrimSuffix(val, ",")
		node.SetIALAttr("custom-riff-decks", val)

		if err = indexWriteJSONQueue(tree); nil != err {
			return
		}

		cache.PutBlockIAL(blockID, parse.IAL2Map(node.KramdownIAL))

		newAttrs := parse.IAL2Map(node.KramdownIAL)
		doOp := &Operation{Action: "updateAttrs", Data: map[string]interface{}{"old": oldAttrs, "new": newAttrs}, ID: blockID}
		trans := []*Transaction{{
			DoOperations:   []*Operation{doOp},
			UndoOperations: []*Operation{},
		}}
		pushBroadcastAttrTransactions(trans)
	}

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

	Decks = map[string]*riff.Deck{}

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

func RenameDeck(deckID, name string) (err error) {
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

func RemoveDeck(deckID string) (err error) {
	riffSavePath := getRiffDir()
	deckPath := filepath.Join(riffSavePath, deckID+".deck")
	if err = os.Remove(deckPath); nil != err {
		return
	}
	cardsPath := filepath.Join(riffSavePath, deckID+".cards")
	if err = os.Remove(cardsPath); nil != err {
		return
	}

	InitFlashcards()
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
