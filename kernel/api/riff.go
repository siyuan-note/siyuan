// SiYuan - Refactor your thinking
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

func getRiffCardsByBlockIDs(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}
	blockIDsArg := arg["blockIDs"].([]interface{})
	var blockIDs []string
	for _, blockID := range blockIDsArg {
		blockIDs = append(blockIDs, blockID.(string))
	}

	blocks := model.GetFlashcardsByBlockIDs(blockIDs)
	ret.Data = map[string]interface{}{
		"blocks": blocks,
	}
}

func batchSetRiffCardsDueTime(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	var cardDues []*model.SetFlashcardDueTime
	for _, cardDueArg := range arg["cardDues"].([]interface{}) {
		cardDue := cardDueArg.(map[string]interface{})
		cardDues = append(cardDues, &model.SetFlashcardDueTime{
			ID:  cardDue["id"].(string),
			Due: cardDue["due"].(string),
		})
	}

	err := model.SetFlashcardsDueTime(cardDues)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
	}
}

func resetRiffCards(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	typ := arg["type"].(string)      // notebook, tree, deck
	id := arg["id"].(string)         // notebook ID, root ID, deck ID
	deckID := arg["deckID"].(string) // deck ID
	blockIDsArg := arg["blockIDs"]   // 如果不传入 blockIDs （或者传入实参为空数组），则重置所有卡片
	var blockIDs []string
	if nil != blockIDsArg {
		for _, blockID := range blockIDsArg.([]interface{}) {
			blockIDs = append(blockIDs, blockID.(string))
		}
	}

	model.ResetFlashcards(typ, id, deckID, blockIDs)
}

func getNotebookRiffCards(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	notebookID := arg["id"].(string)
	page := int(arg["page"].(float64))
	pageSize := 20
	if nil != arg["pageSize"] {
		pageSize = int(arg["pageSize"].(float64))
	}
	blockIDs, total, pageCount := model.GetNotebookFlashcards(notebookID, page, pageSize)
	ret.Data = map[string]interface{}{
		"blocks":    blockIDs,
		"total":     total,
		"pageCount": pageCount,
	}
}

func getTreeRiffCards(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	rootID := arg["id"].(string)
	page := int(arg["page"].(float64))
	pageSize := 20
	if nil != arg["pageSize"] {
		pageSize = int(arg["pageSize"].(float64))
	}
	blockIDs, total, pageCount := model.GetTreeFlashcards(rootID, page, pageSize)
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
	pageSize := 20
	if nil != arg["pageSize"] {
		pageSize = int(arg["pageSize"].(float64))
	}
	blocks, total, pageCount := model.GetDeckFlashcards(deckID, page, pageSize)
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
	rating := int(arg["rating"].(float64))
	reviewedCardIDs := getReviewedCards(arg)
	err := model.ReviewFlashcard(deckID, cardID, riff.Rating(rating), reviewedCardIDs)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
}

func skipReviewRiffCard(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	deckID := arg["deckID"].(string)
	cardID := arg["cardID"].(string)
	err := model.SkipReviewFlashcard(deckID, cardID)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
}

func getNotebookRiffDueCards(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	notebookID := arg["notebook"].(string)
	reviewedCardIDs := getReviewedCards(arg)
	cards, unreviewedCount, unreviewedNewCardCount, unreviewedOldCardCount, err := model.GetNotebookDueFlashcards(notebookID, reviewedCardIDs)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	ret.Data = map[string]interface{}{
		"cards":                  cards,
		"unreviewedCount":        unreviewedCount,
		"unreviewedNewCardCount": unreviewedNewCardCount,
		"unreviewedOldCardCount": unreviewedOldCardCount,
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
	reviewedCardIDs := getReviewedCards(arg)
	cards, unreviewedCount, unreviewedNewCardCount, unreviewedOldCardCount, err := model.GetTreeDueFlashcards(rootID, reviewedCardIDs)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	ret.Data = map[string]interface{}{
		"cards":                  cards,
		"unreviewedCount":        unreviewedCount,
		"unreviewedNewCardCount": unreviewedNewCardCount,
		"unreviewedOldCardCount": unreviewedOldCardCount,
	}
}

func getRiffDueCards(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	deckID := arg["deckID"].(string)
	reviewedCardIDs := getReviewedCards(arg)
	cards, unreviewedCount, unreviewedNewCardCount, unreviewedOldCardCount, err := model.GetDueFlashcards(deckID, reviewedCardIDs)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	ret.Data = map[string]interface{}{
		"cards":                  cards,
		"unreviewedCount":        unreviewedCount,
		"unreviewedNewCardCount": unreviewedNewCardCount,
		"unreviewedOldCardCount": unreviewedOldCardCount,
	}
}

func getReviewedCards(arg map[string]interface{}) (ret []string) {
	if nil == arg["reviewedCards"] {
		return
	}

	reviewedCardsArg := arg["reviewedCards"].([]interface{})
	for _, card := range reviewedCardsArg {
		c := card.(map[string]interface{})
		cardID := c["cardID"].(string)
		ret = append(ret, cardID)
	}
	return
}

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

	transactions := []*model.Transaction{
		{
			DoOperations: []*model.Operation{
				{
					Action:   "removeFlashcards",
					DeckID:   deckID,
					BlockIDs: blockIDs,
				},
			},
		},
	}

	model.PerformTransactions(&transactions)
	model.FlushTxQueue()

	if "" != deckID {
		deck := model.Decks[deckID]
		ret.Data = deckData(deck)
	}
	// All 卡包不返回数据
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

	transactions := []*model.Transaction{
		{
			DoOperations: []*model.Operation{
				{
					Action:   "addFlashcards",
					DeckID:   deckID,
					BlockIDs: blockIDs,
				},
			},
		},
	}

	model.PerformTransactions(&transactions)
	model.FlushTxQueue()

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
	if err != nil {
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
	if err != nil {
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
	if err != nil {
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
