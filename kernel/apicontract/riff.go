package apicontract

import (
	"io"
	"reflect"
)

type RiffBlockIDsRequest struct {
	BlockIDs []string `json:"blockIDs"`
}

type RiffDeckCardsRequest struct {
	DeckID string `json:"deckID"`
	RiffBlockIDsRequest
}

type RiffDeckRequest struct {
	DeckID string `json:"deckID"`
}

type CreateRiffDeckRequest struct {
	Name string `json:"name"`
}

type RenameRiffDeckRequest struct {
	DeckID string `json:"deckID"`
	Name   string `json:"name"`
}

type RiffDeck struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Size    int    `json:"size"`
	Created string `json:"created"`
	Updated string `json:"updated"`
}

type RiffCardsRequest struct {
	ID              string   `json:"id"`
	Page            float64  `json:"page"`
	PageSize        *float64 `json:"pageSize" api:"optional"`
	paginationError error
}

// Pagination 在笔记本或文档准入完成后报告分页错误。
func (r RiffCardsRequest) Pagination() (page, pageSize int, err error) {
	page, pageSize = int(r.Page), 20
	if r.PageSize != nil {
		pageSize = int(*r.PageSize)
	}
	return page, pageSize, r.paginationError
}

type RiffCardsData struct {
	Blocks    []*SearchBlock `json:"blocks"`
	Total     int            `json:"total"`
	PageCount int            `json:"pageCount"`
}

type RiffBlocksData struct {
	Blocks []*SearchBlock `json:"blocks"`
}

type RiffReviewedCard struct {
	CardID string `json:"cardID"`
}

type RiffReviewedCards struct {
	ReviewedCards []RiffReviewedCard `json:"reviewedCards" api:"optional,nullable"`
}

func (r RiffReviewedCards) IDs() (ids []string) {
	for _, card := range r.ReviewedCards {
		ids = append(ids, card.CardID)
	}
	return
}

type RiffDueCardsRequest struct {
	DeckID string `json:"deckID"`
	RiffReviewedCards
}

type RiffTreeDueCardsRequest struct {
	RootID string `json:"rootID"`
	RiffReviewedCards
}

type RiffNotebookDueCardsRequest struct {
	Notebook string `json:"notebook"`
	RiffReviewedCards
}

type RiffCardRequest struct {
	DeckID string `json:"deckID"`
	CardID string `json:"cardID"`
}

type ReviewRiffCardRequest struct {
	RiffCardRequest
	Rating float64 `json:"rating"`
	RiffReviewedCards
}

type RiffDueCard struct {
	DeckID     string            `json:"deckID"`
	CardID     string            `json:"cardID"`
	BlockID    string            `json:"blockID"`
	Lapses     int               `json:"lapses"`
	Reps       int               `json:"reps"`
	State      int               `json:"state"`
	LastReview int64             `json:"lastReview"`
	NextDues   map[string]string `json:"nextDues"`
}

type RiffDueCardsData struct {
	Cards                  []*RiffDueCard `json:"cards"`
	UnreviewedCount        int            `json:"unreviewedCount"`
	UnreviewedNewCardCount int            `json:"unreviewedNewCardCount"`
	UnreviewedOldCardCount int            `json:"unreviewedOldCardCount"`
}

type ResetRiffCardsRequest struct {
	Type     string   `json:"type"`
	ID       string   `json:"id"`
	DeckID   string   `json:"deckID"`
	BlockIDs []string `json:"blockIDs" api:"optional,nullable"`
}

type RiffCardDue struct {
	ID  string `json:"id"`
	Due string `json:"due"`
}

type SetRiffCardsDueRequest struct {
	CardDues []RiffCardDue `json:"cardDues"`
}

func decodeRiffCards(reader io.Reader, path string) (request RiffCardsRequest, err error) {
	fields, err := blockRequestFields(reader, path)
	if err != nil {
		return request, err
	}
	var identity struct {
		ID string `json:"id"`
	}
	if err = decodeRequestFields(reflect.ValueOf(&identity).Elem(), fields); err != nil {
		return request, err
	}
	request.ID = identity.ID
	var pagination struct {
		Page     float64  `json:"page"`
		PageSize *float64 `json:"pageSize" api:"optional"`
	}
	request.paginationError = decodeRequestFields(reflect.ValueOf(&pagination).Elem(), fields)
	request.Page, request.PageSize = pagination.Page, pagination.PageSize
	return request, nil
}

func init() {
	for _, endpoint := range []*Endpoint[RiffCardsRequest, RiffCardsData]{&GetRiffCards, &GetTreeRiffCards, &GetNotebookRiffCards} {
		endpoint.decodeRequest = func(reader io.Reader) (RiffCardsRequest, error) {
			return decodeRiffCards(reader, endpoint.Definition().Path)
		}
	}
}
