// SiYuan - From thought to insight, with agents
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
	flashcardv2 "github.com/siyuan-note/siyuan/kernel/flashcard"
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
	blockIDsArg := arg["blockIDs"].([]any)
	var blockIDs []string
	for _, blockID := range blockIDsArg {
		blockIDs = append(blockIDs, blockID.(string))
	}
	if err := model.ValidateFlashcardBlockIDs(blockIDs); err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
	if active, ok := useFlashcardV2RiffAdapter(c, ret); !ok {
		return
	} else if active {
		blocks, err := model.GetLegacyFlashcardV2BlocksByIDs(c.Request.Context(), blockIDs)
		if err != nil {
			ret.Code = -1
			ret.Msg = err.Error()
			return
		}
		ret.Data = map[string]any{"blocks": blocks}
		return
	}

	blocks := model.GetFlashcardsByBlockIDs(blockIDs)
	ret.Data = map[string]any{
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
	for _, cardDueArg := range arg["cardDues"].([]any) {
		cardDue := cardDueArg.(map[string]any)
		cardDues = append(cardDues, &model.SetFlashcardDueTime{
			ID:  cardDue["id"].(string),
			Due: cardDue["due"].(string),
		})
	}
	if active, ok := useFlashcardV2RiffAdapter(c, ret); !ok {
		return
	} else if active {
		if err := model.SetLegacyFlashcardV2DueTimes(c.Request.Context(), cardDues); err != nil {
			ret.Code = -1
			ret.Msg = err.Error()
		}
		return
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
		for _, blockID := range blockIDsArg.([]any) {
			blockIDs = append(blockIDs, blockID.(string))
		}
	}
	if active, ok := useFlashcardV2RiffAdapter(c, ret); !ok {
		return
	} else if active {
		if err := model.ResetLegacyFlashcardV2Cards(c.Request.Context(), typ, id, deckID, blockIDs); err != nil {
			ret.Code = -1
			ret.Msg = err.Error()
		}
		return
	}

	if err := model.ResetFlashcards(typ, id, deckID, blockIDs); err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
	}
}

func getNotebookRiffCards(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	notebookID := arg["id"].(string)
	if model.IsEncryptedBox(notebookID) {
		ret.Code = -1
		ret.Msg = model.Conf.Language(313)
		return
	}
	page := int(arg["page"].(float64))
	pageSize := 20
	if nil != arg["pageSize"] {
		pageSize = int(arg["pageSize"].(float64))
	}
	if active, ok := useFlashcardV2RiffAdapter(c, ret); !ok {
		return
	} else if active {
		blocks, total, pageCount, err := model.GetLegacyNotebookFlashcardV2Blocks(c.Request.Context(), notebookID,
			page, pageSize)
		if err != nil {
			ret.Code = -1
			ret.Msg = err.Error()
			return
		}
		ret.Data = map[string]any{"blocks": blocks, "total": total, "pageCount": pageCount}
		return
	}
	blockIDs, total, pageCount := model.GetNotebookFlashcards(notebookID, page, pageSize)
	ret.Data = map[string]any{
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
	if err := model.ValidateFlashcardBlockIDs([]string{rootID}); err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
	page := int(arg["page"].(float64))
	pageSize := 20
	if nil != arg["pageSize"] {
		pageSize = int(arg["pageSize"].(float64))
	}
	if active, ok := useFlashcardV2RiffAdapter(c, ret); !ok {
		return
	} else if active {
		blocks, total, pageCount, err := model.GetLegacyTreeFlashcardV2Blocks(c.Request.Context(), rootID, page,
			pageSize)
		if err != nil {
			ret.Code = -1
			ret.Msg = err.Error()
			return
		}
		ret.Data = map[string]any{"blocks": blocks, "total": total, "pageCount": pageCount}
		return
	}
	blockIDs, total, pageCount := model.GetTreeFlashcards(rootID, page, pageSize)
	ret.Data = map[string]any{
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
	if active, ok := useFlashcardV2RiffAdapter(c, ret); !ok {
		return
	} else if active {
		blocks, total, pageCount, err := model.GetLegacyFlashcardV2Blocks(c.Request.Context(), deckID, nil, page,
			pageSize)
		if err != nil {
			ret.Code = -1
			ret.Msg = err.Error()
			return
		}
		ret.Data = map[string]any{"blocks": blocks, "total": total, "pageCount": pageCount}
		return
	}
	blocks, total, pageCount := model.GetDeckFlashcards(deckID, page, pageSize)
	ret.Data = map[string]any{
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
	if active, ok := useFlashcardV2RiffAdapter(c, ret); !ok {
		return
	} else if active {
		durationMS := int64(0)
		if value, found := arg["durationMS"].(float64); found && value >= 0 {
			durationMS = int64(value)
		}
		if err := model.ReviewLegacyFlashcardV2Card(c.Request.Context(), deckID, cardID, riff.Rating(rating),
			durationMS); err != nil {
			ret.Code = -1
			ret.Msg = err.Error()
		}
		return
	}
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
	if active, ok := useFlashcardV2RiffAdapter(c, ret); !ok {
		return
	} else if active {
		if err := model.SkipLegacyFlashcardV2Card(c.Request.Context(), deckID, cardID); err != nil {
			ret.Code = -1
			ret.Msg = err.Error()
		}
		return
	}
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
	if active, ok := useFlashcardV2RiffAdapter(c, ret); !ok {
		return
	} else if active {
		cards, unreviewedCount, unreviewedNewCardCount, unreviewedOldCardCount, err :=
			model.GetLegacyNotebookFlashcardV2DueCards(c.Request.Context(), notebookID, reviewedCardIDs)
		if err != nil {
			ret.Code = -1
			ret.Msg = err.Error()
			return
		}
		ret.Data = map[string]any{"cards": cards, "unreviewedCount": unreviewedCount,
			"unreviewedNewCardCount": unreviewedNewCardCount, "unreviewedOldCardCount": unreviewedOldCardCount}
		return
	}
	cards, unreviewedCount, unreviewedNewCardCount, unreviewedOldCardCount, err := model.GetNotebookDueFlashcards(notebookID, reviewedCardIDs)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	ret.Data = map[string]any{
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
	if active, ok := useFlashcardV2RiffAdapter(c, ret); !ok {
		return
	} else if active {
		cards, unreviewedCount, unreviewedNewCardCount, unreviewedOldCardCount, err :=
			model.GetLegacyTreeFlashcardV2DueCards(c.Request.Context(), rootID, reviewedCardIDs)
		if err != nil {
			ret.Code = -1
			ret.Msg = err.Error()
			return
		}
		ret.Data = map[string]any{"cards": cards, "unreviewedCount": unreviewedCount,
			"unreviewedNewCardCount": unreviewedNewCardCount, "unreviewedOldCardCount": unreviewedOldCardCount}
		return
	}
	cards, unreviewedCount, unreviewedNewCardCount, unreviewedOldCardCount, err := model.GetTreeDueFlashcards(rootID, reviewedCardIDs)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	ret.Data = map[string]any{
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
	if active, ok := useFlashcardV2RiffAdapter(c, ret); !ok {
		return
	} else if active {
		cards, unreviewedCount, unreviewedNewCardCount, unreviewedOldCardCount, err :=
			model.GetLegacyFlashcardV2DueCards(c.Request.Context(), deckID, reviewedCardIDs, nil)
		if err != nil {
			ret.Code = -1
			ret.Msg = err.Error()
			return
		}
		ret.Data = map[string]any{"cards": cards, "unreviewedCount": unreviewedCount,
			"unreviewedNewCardCount": unreviewedNewCardCount, "unreviewedOldCardCount": unreviewedOldCardCount}
		return
	}
	cards, unreviewedCount, unreviewedNewCardCount, unreviewedOldCardCount, err := model.GetDueFlashcards(deckID, reviewedCardIDs)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	ret.Data = map[string]any{
		"cards":                  cards,
		"unreviewedCount":        unreviewedCount,
		"unreviewedNewCardCount": unreviewedNewCardCount,
		"unreviewedOldCardCount": unreviewedOldCardCount,
	}
}

func getReviewedCards(arg map[string]any) (ret []string) {
	if nil == arg["reviewedCards"] {
		return
	}

	reviewedCardsArg := arg["reviewedCards"].([]any)
	for _, card := range reviewedCardsArg {
		c := card.(map[string]any)
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
	blockIDsArg := arg["blockIDs"].([]any)
	var blockIDs []string
	for _, blockID := range blockIDsArg {
		blockIDs = append(blockIDs, blockID.(string))
	}
	if err := model.ValidateFlashcardBlockIDs(blockIDs); err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
	if active, ok := useFlashcardV2RiffAdapter(c, ret); !ok {
		return
	} else if active {
		deck, err := model.RemoveLegacyFlashcardV2Cards(c.Request.Context(), deckID, blockIDs)
		if err != nil {
			ret.Code = -1
			ret.Msg = err.Error()
			return
		}
		if deck != nil {
			ret.Data = legacyFlashcardV2DeckData(*deck)
		}
		return
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
	blockIDsArg := arg["blockIDs"].([]any)
	var blockIDs []string
	for _, blockID := range blockIDsArg {
		blockIDs = append(blockIDs, blockID.(string))
	}
	if err := model.ValidateFlashcardBlockIDs(blockIDs); err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
	if active, ok := useFlashcardV2RiffAdapter(c, ret); !ok {
		return
	} else if active {
		deck, err := model.AddLegacyFlashcardV2Cards(c.Request.Context(), deckID, blockIDs)
		if err != nil {
			ret.Code = -1
			ret.Msg = err.Error()
			return
		}
		ret.Data = legacyFlashcardV2DeckData(deck)
		return
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
	if active, ok := useFlashcardV2RiffAdapter(c, ret); !ok {
		return
	} else if active {
		if err := model.RenameLegacyFlashcardV2ReviewSet(c.Request.Context(), deckID, name); err != nil {
			ret.Code = -1
			ret.Msg = err.Error()
		}
		return
	}
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
	if active, ok := useFlashcardV2RiffAdapter(c, ret); !ok {
		return
	} else if active {
		if err := model.RemoveLegacyFlashcardV2ReviewSet(c.Request.Context(), deckID); err != nil {
			ret.Code = -1
			ret.Msg = err.Error()
		}
		return
	}
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
	if active, ok := useFlashcardV2RiffAdapter(c, ret); !ok {
		return
	} else if active {
		deck, err := model.CreateLegacyFlashcardV2ReviewSet(c.Request.Context(), "", name)
		if err != nil {
			ret.Code = -1
			ret.Msg = err.Error()
			return
		}
		ret.Data = legacyFlashcardV2DeckData(deck)
		return
	}
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

	if active, ok := useFlashcardV2RiffAdapter(c, ret); !ok {
		return
	} else if active {
		decks, err := model.GetLegacyFlashcardV2ReviewSets(c.Request.Context())
		if err != nil {
			ret.Code = -1
			ret.Msg = err.Error()
			return
		}
		data := make([]any, 0, len(decks))
		for _, deck := range decks {
			data = append(data, legacyFlashcardV2DeckData(deck))
		}
		ret.Data = data
		return
	}

	decks := model.GetDecks()
	var data []any
	for _, deck := range decks {
		data = append(data, deckData(deck))
	}
	if 1 > len(data) {
		data = []any{}
	}
	ret.Data = data
}

func deckData(deck *riff.Deck) map[string]any {
	return map[string]any{
		"id":      deck.ID,
		"name":    deck.Name,
		"size":    model.CountSupportedFlashcards(deck),
		"created": time.UnixMilli(deck.Created).Format("2006-01-02 15:04:05"),
		"updated": time.UnixMilli(deck.Updated).Format("2006-01-02 15:04:05"),
	}
}

func useFlashcardV2RiffAdapter(c *gin.Context, ret *gulu.Result) (active, ok bool) {
	active, err := model.UseFlashcardV2Compatibility(c.Request.Context())
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return false, false
	}
	if active {
		c.Header("Deprecation", "true")
		c.Header("X-SiYuan-Replacement", "/api/flashcard")
	}
	return active, true
}

func legacyFlashcardV2DeckData(deck flashcardv2.LegacyReviewSetInfo) map[string]any {
	return map[string]any{
		"id":      deck.DeckID,
		"name":    deck.Name,
		"size":    deck.Size,
		"created": time.UnixMilli(deck.CreatedAt).Format("2006-01-02 15:04:05"),
		"updated": time.UnixMilli(deck.UpdatedAt).Format("2006-01-02 15:04:05"),
	}
}
