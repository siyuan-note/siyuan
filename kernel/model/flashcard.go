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
	"github.com/88250/lute/ast"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/riff"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var Decks = map[string]*riff.Deck{}
var deckLock = sync.Mutex{}

func AddFlashcard(blockID string, deckName string) (err error) {
	deckLock.Lock()
	deck := Decks[deckName]
	deckLock.Unlock()

	cardID := ast.NewNodeID()
	deck.AddCard(cardID, blockID)
	err = deck.Save()
	if nil != err {
		logging.LogErrorf("save deck [%s] failed: %s", deckName, err)
		return
	}
	return
}

func InitFlashcards() {
	riffSavePath := getRiffDir()
	if !gulu.File.IsDir(riffSavePath) {
		return
	}

	entries, err := os.ReadDir(riffSavePath)
	if nil != err {
		logging.LogErrorf("read riff dir failed: %s", err)
		return
	}
	for _, entry := range entries {
		name := entry.Name()
		if strings.HasSuffix(name, "-deck.msgpack") {
			name = name[:len(name)-len("-deck.msgpack")]
			deckName := strings.Split(name, "-")[0]
			algo := strings.Split(name, "-")[1]
			deck, loadErr := riff.LoadDeck(riffSavePath, deckName, riff.Algo(algo))
			if nil != loadErr {
				logging.LogErrorf("load deck [%s] failed: %s", name, loadErr)
				continue
			}

			deckLock.Lock()
			Decks[deckName] = deck
			deckLock.Unlock()
		}
	}
}

func CreateDeck(name string) (err error) {
	riffSavePath := getRiffDir()
	deck, err := riff.LoadDeck(riffSavePath, name, riff.AlgoFSRS)
	if nil != err {
		logging.LogErrorf("load deck [%s] failed: %s", name, err)
		return
	}

	deckLock.Lock()
	Decks[name] = deck
	deckLock.Unlock()
	return
}

func SaveDeck(name string) (err error) {
	deckLock.Lock()
	deck := Decks[name]
	deckLock.Unlock()

	err = deck.Save()
	if nil != err {
		logging.LogErrorf("save deck [%s] failed: %s", name, err)
		return
	}
	return
}

func getRiffDir() string {
	return filepath.Join(util.DataDir, "storage", "riff")
}
