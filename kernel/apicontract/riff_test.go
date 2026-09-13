package apicontract

import (
	"strings"
	"testing"
)

func TestRiffPaginationCompatibility(t *testing.T) {
	for _, endpoint := range []Endpoint[RiffCardsRequest, RiffCardsData]{GetRiffCards, GetTreeRiffCards, GetNotebookRiffCards} {
		for _, entry := range []struct {
			body       string
			page, size int
			deferred   bool
		}{
			{`{"id":" untouched ","page":2.9}`, 2, 20, false},
			{`{"id":" untouched ","page":-2.9,"pageSize":-3.9}`, -2, -3, false},
			{`{"id":" untouched ","page":0,"pageSize":null}`, 0, 20, false},
			{`{"id":" untouched ","page":1,"pageSize":0}`, 1, 0, false},
			{`{"id":" untouched ","page":null}`, 0, 20, true},
			{`{"id":" untouched ","page":1,"pageSize":false}`, 1, 20, true},
			{`{"id":" untouched "}`, 0, 20, true},
		} {
			request, err := endpoint.Decode(strings.NewReader(entry.body))
			if err != nil || request.ID != " untouched " {
				t.Fatalf("identity decoding changed: %+v, %v", request, err)
			}
			page, size, err := request.Pagination()
			if (err != nil) != entry.deferred || !entry.deferred && (page != entry.page || size != entry.size) {
				t.Fatalf("pagination changed: %s: %d %d %v", entry.body, page, size, err)
			}
		}
		for _, body := range []string{`{}`, `{"id":null}`, `{"id":3}`, ``} {
			if _, err := endpoint.Decode(strings.NewReader(body)); err == nil {
				t.Fatalf("invalid identity accepted: %s", body)
			}
		}
	}
}

func TestRiffReviewedCardsCompatibility(t *testing.T) {
	for _, suffix := range []string{``, `,"reviewedCards":null`, `,"reviewedCards":[]`} {
		request, err := ReviewRiffCard.Decode(strings.NewReader(`{"deckID":" deck ","cardID":" card ","rating":2.9` + suffix + `}`))
		if err != nil || request.IDs() != nil || request.DeckID != " deck " || int(request.Rating) != 2 {
			t.Fatalf("review defaults changed: %+v, %v", request, err)
		}
	}
	request, err := GetRiffDueCards.Decode(strings.NewReader(`{"deckID":"deck","reviewedCards":[{"cardID":" first ","ignored":true},{"cardID":"second"},{"cardID":"second"}]}`))
	if err != nil || strings.Join(request.IDs(), ",") != " first ,second,second" {
		t.Fatalf("review IDs changed: %+v, %v", request, err)
	}
	for _, body := range []string{`{"deckID":"d","reviewedCards":[null]}`, `{"deckID":"d","reviewedCards":[{}]}`, `{"deckID":"d","reviewedCards":[{"cardID":null}]}`, `{"deckID":"d","reviewedCards":false}`} {
		if _, err := GetRiffDueCards.Decode(strings.NewReader(body)); err == nil {
			t.Fatalf("invalid reviewed card accepted: %s", body)
		}
	}
}

func TestRiffRequestCompatibility(t *testing.T) {
	for _, suffix := range []string{``, `,"blockIDs":null`, `,"blockIDs":[]`} {
		request, err := ResetRiffCards.Decode(strings.NewReader(`{"type":" deck ","id":" id ","deckID":" deck "` + suffix + `}`))
		if err != nil || len(request.BlockIDs) != 0 || request.Type != " deck " {
			t.Fatalf("reset defaults changed: %+v, %v", request, err)
		}
	}
	for _, body := range []string{`{}`, `{"blockIDs":null}`, `{"blockIDs":[null]}`, `{"blockIDs":[1]}`} {
		if _, err := GetRiffCardsByBlockIDs.Decode(strings.NewReader(body)); err == nil {
			t.Fatalf("invalid blocks accepted: %s", body)
		}
	}
	request, err := BatchSetRiffCardsDueTime.Decode(strings.NewReader(`{"cardDues":[{"id":" id ","due":" date ","other":1}]}`))
	if err != nil || request.CardDues[0].ID != " id " || request.CardDues[0].Due != " date " {
		t.Fatalf("due time changed: %+v, %v", request, err)
	}
	for _, body := range []string{`{"cardDues":null}`, `{"cardDues":[null]}`, `{"cardDues":[{"id":"x"}]}`} {
		if _, err := BatchSetRiffCardsDueTime.Decode(strings.NewReader(body)); err == nil {
			t.Fatalf("invalid due accepted: %s", body)
		}
	}
	if _, err := GetRiffDecks.Decode(strings.NewReader("invalid body")); err != nil {
		t.Fatal(err)
	}
}
