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
	"github.com/88250/gulu"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/riff"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
	"strconv"
	"time"
)

var getRiffCardsByBlockIDs = contractHandler(apicontract.GetRiffCardsByBlockIDs, func(c *gin.Context, request apicontract.RiffBlockIDsRequest) apicontract.Response[apicontract.RiffBlocksData] {
	blockIDs := riffBlockIDs(request.BlockIDs)
	if err := model.ValidateFlashcardBlockIDs(blockIDs); err != nil {
		return apicontract.Failure[apicontract.RiffBlocksData](-1, err.Error())
	}
	return apicontract.Success(apicontract.RiffBlocksData{Blocks: searchBlockContracts(model.GetFlashcardsByBlockIDs(blockIDs))})
})

var batchSetRiffCardsDueTime = contractHandler(apicontract.BatchSetRiffCardsDueTime, func(c *gin.Context, request apicontract.SetRiffCardsDueRequest) apicontract.Response[apicontract.Null] {
	var cardDues []*model.SetFlashcardDueTime
	for _, due := range request.CardDues {
		cardDues = append(cardDues, &model.SetFlashcardDueTime{ID: due.ID, Due: due.Due})
	}
	if err := model.SetFlashcardsDueTime(cardDues); err != nil {
		return apicontract.Failure[apicontract.Null](-1, err.Error())
	}
	return apicontract.Success(apicontract.Null{})
})

var resetRiffCards = contractHandler(apicontract.ResetRiffCards, func(c *gin.Context, request apicontract.ResetRiffCardsRequest) apicontract.Response[apicontract.Null] {
	if err := model.ResetFlashcards(request.Type, request.ID, request.DeckID, riffBlockIDs(request.BlockIDs)); err != nil {
		return apicontract.Failure[apicontract.Null](-1, err.Error())
	}
	return apicontract.Success(apicontract.Null{})
})

var getNotebookRiffCards = contractHandler(apicontract.GetNotebookRiffCards, func(c *gin.Context, request apicontract.RiffCardsRequest) apicontract.Response[apicontract.RiffCardsData] {
	if model.IsEncryptedBox(request.ID) {
		return apicontract.Failure[apicontract.RiffCardsData](-1, model.Conf.Language(393))
	}
	page, pageSize, err := request.Pagination()
	if err != nil {
		return apicontract.Failure[apicontract.RiffCardsData](-1, err.Error())
	}
	blocks, total, pageCount := model.GetNotebookFlashcards(request.ID, page, pageSize)
	return apicontract.Success(riffCardsData(blocks, total, pageCount))
})

var getTreeRiffCards = contractHandler(apicontract.GetTreeRiffCards, func(c *gin.Context, request apicontract.RiffCardsRequest) apicontract.Response[apicontract.RiffCardsData] {
	if err := model.ValidateFlashcardBlockIDs([]string{request.ID}); err != nil {
		return apicontract.Failure[apicontract.RiffCardsData](-1, err.Error())
	}
	page, pageSize, err := request.Pagination()
	if err != nil {
		return apicontract.Failure[apicontract.RiffCardsData](-1, err.Error())
	}
	blocks, total, pageCount := model.GetTreeFlashcards(request.ID, page, pageSize)
	return apicontract.Success(riffCardsData(blocks, total, pageCount))
})

var getRiffCards = contractHandler(apicontract.GetRiffCards, func(c *gin.Context, request apicontract.RiffCardsRequest) apicontract.Response[apicontract.RiffCardsData] {
	page, pageSize, err := request.Pagination()
	if err != nil {
		return apicontract.Failure[apicontract.RiffCardsData](-1, err.Error())
	}
	blocks, total, pageCount := model.GetDeckFlashcards(request.ID, page, pageSize)
	return apicontract.Success(riffCardsData(blocks, total, pageCount))
})

var reviewRiffCard = contractHandler(apicontract.ReviewRiffCard, func(c *gin.Context, request apicontract.ReviewRiffCardRequest) apicontract.Response[apicontract.Null] {
	if err := model.ReviewFlashcard(request.DeckID, request.CardID, riff.Rating(int(request.Rating)), request.IDs()); err != nil {
		return apicontract.Failure[apicontract.Null](-1, err.Error())
	}
	return apicontract.Success(apicontract.Null{})
})

var skipReviewRiffCard = contractHandler(apicontract.SkipReviewRiffCard, func(c *gin.Context, request apicontract.RiffCardRequest) apicontract.Response[apicontract.Null] {
	if err := model.SkipReviewFlashcard(request.DeckID, request.CardID); err != nil {
		return apicontract.Failure[apicontract.Null](-1, err.Error())
	}
	return apicontract.Success(apicontract.Null{})
})

var getNotebookRiffDueCards = contractHandler(apicontract.GetNotebookRiffDueCards, func(c *gin.Context, request apicontract.RiffNotebookDueCardsRequest) apicontract.Response[apicontract.RiffDueCardsData] {
	cards, count, newCount, oldCount, err := model.GetNotebookDueFlashcards(request.Notebook, request.IDs())
	if err != nil {
		return apicontract.Failure[apicontract.RiffDueCardsData](-1, err.Error())
	}
	return apicontract.Success(riffDueCardsData(cards, count, newCount, oldCount))
})

var getTreeRiffDueCards = contractHandler(apicontract.GetTreeRiffDueCards, func(c *gin.Context, request apicontract.RiffTreeDueCardsRequest) apicontract.Response[apicontract.RiffDueCardsData] {
	cards, count, newCount, oldCount, err := model.GetTreeDueFlashcards(request.RootID, request.IDs())
	if err != nil {
		return apicontract.Failure[apicontract.RiffDueCardsData](-1, err.Error())
	}
	return apicontract.Success(riffDueCardsData(cards, count, newCount, oldCount))
})

var getRiffDueCards = contractHandler(apicontract.GetRiffDueCards, func(c *gin.Context, request apicontract.RiffDueCardsRequest) apicontract.Response[apicontract.RiffDueCardsData] {
	cards, count, newCount, oldCount, err := model.GetDueFlashcards(request.DeckID, request.IDs())
	if err != nil {
		return apicontract.Failure[apicontract.RiffDueCardsData](-1, err.Error())
	}
	return apicontract.Success(riffDueCardsData(cards, count, newCount, oldCount))
})

var removeRiffCards = contractHandler(apicontract.RemoveRiffCards, func(c *gin.Context, request apicontract.RiffDeckCardsRequest) apicontract.Response[*apicontract.RiffDeck] {
	blockIDs := riffBlockIDs(request.BlockIDs)
	if err := model.ValidateFlashcardBlockIDs(blockIDs); err != nil {
		return apicontract.Failure[*apicontract.RiffDeck](-1, err.Error())
	}
	transactions := []*model.Transaction{{DoOperations: []*model.Operation{{Action: "removeFlashcards", DeckID: request.DeckID, BlockIDs: blockIDs}}}}
	model.PerformTransactions(&transactions)
	model.FlushTxQueue()
	if request.DeckID != "" {
		return apicontract.Success(deckData(model.Decks[request.DeckID]))
	}
	return apicontract.Success[*apicontract.RiffDeck](nil)
})

var addRiffCards = contractHandler(apicontract.AddRiffCards, func(c *gin.Context, request apicontract.RiffDeckCardsRequest) apicontract.Response[*apicontract.RiffDeck] {
	blockIDs := riffBlockIDs(request.BlockIDs)
	if err := model.ValidateFlashcardBlockIDs(blockIDs); err != nil {
		return apicontract.Failure[*apicontract.RiffDeck](-1, err.Error())
	}
	transactions := []*model.Transaction{{DoOperations: []*model.Operation{{Action: "addFlashcards", DeckID: request.DeckID, BlockIDs: blockIDs}}}}
	model.PerformTransactions(&transactions)
	model.FlushTxQueue()
	return apicontract.Success(deckData(model.Decks[request.DeckID]))
})

var renameRiffDeck = contractHandler(apicontract.RenameRiffDeck, func(c *gin.Context, request apicontract.RenameRiffDeckRequest) apicontract.Response[apicontract.Null] {
	if err := model.RenameDeck(request.DeckID, request.Name); err != nil {
		return apicontract.Failure[apicontract.Null](-1, err.Error())
	}
	return apicontract.Success(apicontract.Null{})
})

var removeRiffDeck = contractHandler(apicontract.RemoveRiffDeck, func(c *gin.Context, request apicontract.RiffDeckRequest) apicontract.Response[apicontract.Null] {
	ret := gulu.Ret.NewResult()
	if util.InvalidIDPattern(request.DeckID, ret) {
		return contractFailure[apicontract.Null](ret)
	}
	if err := model.RemoveDeck(request.DeckID); err != nil {
		return apicontract.Failure[apicontract.Null](-1, err.Error())
	}
	return apicontract.Success(apicontract.Null{})
})

var createRiffDeck = contractHandler(apicontract.CreateRiffDeck, func(c *gin.Context, request apicontract.CreateRiffDeckRequest) apicontract.Response[*apicontract.RiffDeck] {
	deck, err := model.CreateDeck(request.Name)
	if err != nil {
		return apicontract.Failure[*apicontract.RiffDeck](-1, err.Error())
	}
	return apicontract.Success(deckData(deck))
})

var getRiffDecks = contractHandler(apicontract.GetRiffDecks, func(c *gin.Context, request apicontract.EmptyRequest) apicontract.Response[[]*apicontract.RiffDeck] {
	decks := model.GetDecks()
	data := make([]*apicontract.RiffDeck, 0, len(decks))
	for _, deck := range decks {
		data = append(data, deckData(deck))
	}
	return apicontract.Success(data)
})

func deckData(deck *riff.Deck) *apicontract.RiffDeck {
	return &apicontract.RiffDeck{ID: deck.ID, Name: deck.Name, Size: model.CountSupportedFlashcards(deck),
		Created: time.UnixMilli(deck.Created).Format("2006-01-02 15:04:05"), Updated: time.UnixMilli(deck.Updated).Format("2006-01-02 15:04:05")}
}

func riffBlockIDs(ids []string) []string {
	if len(ids) == 0 {
		return nil
	}
	return ids
}

func riffCardsData(blocks []*model.Block, total, pageCount int) apicontract.RiffCardsData {
	return apicontract.RiffCardsData{Blocks: searchBlockContracts(blocks), Total: total, PageCount: pageCount}
}

func riffDueCardsData(cards []*model.Flashcard, count, newCount, oldCount int) apicontract.RiffDueCardsData {
	var values []*apicontract.RiffDueCard
	if cards != nil {
		values = make([]*apicontract.RiffDueCard, len(cards))
		for i, card := range cards {
			if card == nil {
				continue
			}
			var nextDues map[string]string
			if card.NextDues != nil {
				nextDues = make(map[string]string, len(card.NextDues))
				for rating, due := range card.NextDues {
					nextDues[strconv.Itoa(int(rating))] = due
				}
			}
			values[i] = &apicontract.RiffDueCard{DeckID: card.DeckID, CardID: card.CardID, BlockID: card.BlockID,
				Lapses: card.Lapses, Reps: card.Reps, State: int(card.State), LastReview: card.LastReview, NextDues: nextDues}
		}
	}
	return apicontract.RiffDueCardsData{Cards: values, UnreviewedCount: count, UnreviewedNewCardCount: newCount, UnreviewedOldCardCount: oldCount}
}
