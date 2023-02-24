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

package api

import (
	"net/http"
	"time"

	"github.com/88250/gulu"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/riff"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func getTreeRiffCards(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	rootID := arg["id"].(string)
	page := int(arg["page"].(float64))
	blockIDs, total, pageCount := model.GetTreeFlashcards(rootID, page)
	ret.Data = map[string]interface{}{
		"blocks":    blockIDs,
		"total":     total,
		"pageCount": pageCount,
	}
}

func getRiffCards(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	deckID := arg["id"].(string)
	page := int(arg["page"].(float64))
	blocks, total, pageCount := model.GetFlashcards(deckID, page)
	ret.Data = map[string]interface{}{
		"blocks":    blocks,
		"total":     total,
		"pageCount": pageCount,
	}
}

func reviewRiffCard(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	deckID := arg["deckID"].(string)
	cardID := arg["cardID"].(string)
	blockID := arg["blockID"].(string)
	rating := int(arg["rating"].(float64))
	err := model.ReviewFlashcard(deckID, cardID, blockID, riff.Rating(rating))
	if nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
}

func getTreeRiffDueCards(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	rootID := arg["rootID"].(string)
	cards, err := model.GetTreeDueFlashcards(rootID)
	if nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	ret.Data = cards
}

func getRiffDueCards(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	deckID := arg["deckID"].(string)
	cards, err := model.GetDueFlashcards(deckID)
	if nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	ret.Data = cards
}

// TODO 删除闪卡
func removeRiffCards(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	deckID := arg["deckID"].(string)
	blockIDsArg := arg["blockIDs"].([]interface{})
	var blockIDs []string
	for _, blockID := range blockIDsArg {
		blockIDs = append(blockIDs, blockID.(string))
	}
	err := model.RemoveFlashcardsByBlockIDs(deckID, blockIDs)
	if nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	deck := model.Decks[deckID]
	ret.Data = deckData(deck)
}

func addRiffCards(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	deckID := arg["deckID"].(string)
	blockIDsArg := arg["blockIDs"].([]interface{})
	var blockIDs []string
	for _, blockID := range blockIDsArg {
		blockIDs = append(blockIDs, blockID.(string))
	}
	err := model.AddFlashcards(deckID, blockIDs)
	if nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	deck := model.Decks[deckID]
	ret.Data = deckData(deck)
}

func renameRiffDeck(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	deckID := arg["deckID"].(string)
	name := arg["name"].(string)
	err := model.RenameDeck(deckID, name)
	if nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
}

func removeRiffDeck(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	deckID := arg["deckID"].(string)
	err := model.RemoveDeck(deckID)
	if nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
}

func createRiffDeck(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	name := arg["name"].(string)
	deck, err := model.CreateDeck(name)
	if nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
	ret.Data = deckData(deck)
}

func getRiffDecks(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	decks := model.GetDecks()
	var data []interface{}
	for _, deck := range decks {
		data = append(data, deckData(deck))
	}
	if 1 > len(data) {
		data = []interface{}{}
	}
	ret.Data = data
}

func deckData(deck *riff.Deck) map[string]interface{} {
	return map[string]interface{}{
		"id":      deck.ID,
		"name":    deck.Name,
		"size":    deck.CountCards(),
		"created": time.UnixMilli(deck.Created).Format("2006-01-02 15:04:05"),
		"updated": time.UnixMilli(deck.Updated).Format("2006-01-02 15:04:05"),
	}
}
