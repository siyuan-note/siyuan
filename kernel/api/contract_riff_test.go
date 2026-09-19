package api

import (
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/riff"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAPIContractRiffSerialization(t *testing.T) {
	for _, cards := range [][]*model.Flashcard{nil, {}, {nil}, {{DeckID: "deck", CardID: "card", BlockID: "block", Lapses: 2, Reps: 3, State: 1, LastReview: 1234567891234, NextDues: map[riff.Rating]string{0: "now", 3: "later"}}, {NextDues: map[riff.Rating]string{}}}} {
		actual, err := json.Marshal(riffDueCardsData(cards, 3, 1, 2))
		if err != nil {
			t.Fatal(err)
		}
		expected, err := json.Marshal(map[string]interface{}{"cards": cards, "unreviewedCount": 3, "unreviewedNewCardCount": 1, "unreviewedOldCardCount": 2})
		if err != nil {
			t.Fatal(err)
		}
		var got, want interface{}
		if json.Unmarshal(actual, &got) != nil || json.Unmarshal(expected, &want) != nil || !reflect.DeepEqual(got, want) {
			t.Fatalf("due card serialization changed: %s != %s", actual, expected)
		}
		payload, err := json.Marshal(apicontract.Success(riffDueCardsData(cards, 3, 1, 2)))
		if err != nil {
			t.Fatal(err)
		}
		bundle, err := apicontract.BuildBundle()
		if err != nil {
			t.Fatal(err)
		}
		if err = bundle.ValidateResponse("POST", "/api/riff/getRiffDueCards", payload); err != nil {
			t.Fatal(err)
		}
	}
}

func riffContractRequest(t *testing.T, name string, handler gin.HandlerFunc, body string) (code int, message string, data json.RawMessage) {
	t.Helper()
	engine := gin.New()
	path := "/api/riff/" + name
	engine.POST(path, handler)
	recorder := httptest.NewRecorder()
	engine.ServeHTTP(recorder, httptest.NewRequest("POST", path, strings.NewReader(body)))
	requireAPIContract(t, "POST", path, recorder)
	var response struct {
		Code int             `json:"code"`
		Msg  string          `json:"msg"`
		Data json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	return response.Code, response.Msg, response.Data
}

func TestAPIContractRiffEmptyAndMissing(t *testing.T) {
	previousConf, previousDecks := model.Conf, model.Decks
	model.Conf, model.Decks = model.NewAppConf(), map[string]*riff.Deck{}
	t.Cleanup(func() { model.Conf, model.Decks = previousConf, previousDecks })
	for _, entry := range []struct {
		name           string
		handler        gin.HandlerFunc
		body, expected string
	}{
		{"getRiffDecks", getRiffDecks, "invalid body", `[]`},
		{"getRiffCards", getRiffCards, `{"id":"missing","page":1.9}`, `{"blocks":[],"total":0,"pageCount":0}`},
		{"getRiffDueCards", getRiffDueCards, `{"deckID":"missing","reviewedCards":null}`, `{"cards":null,"unreviewedCount":0,"unreviewedNewCardCount":0,"unreviewedOldCardCount":0}`},
		{"getRiffCardsByBlockIDs", getRiffCardsByBlockIDs, `{"blockIDs":[]}`, `{"blocks":[]}`},
		{"reviewRiffCard", reviewRiffCard, `{"deckID":"missing","cardID":"missing","rating":2.9}`, `null`},
		{"skipReviewRiffCard", skipReviewRiffCard, `{"deckID":"missing","cardID":"missing"}`, `null`},
		{"batchSetRiffCardsDueTime", batchSetRiffCardsDueTime, `{"cardDues":[]}`, `null`},
	} {
		code, msg, data := riffContractRequest(t, entry.name, entry.handler, entry.body)
		if code != 0 || msg != "" || string(data) != entry.expected {
			t.Fatalf("%s response changed: %d %s %s", entry.name, code, msg, data)
		}
	}
}

func TestAPIContractRiffDeckLifecycle(t *testing.T) {
	previousConf, previousDecks, previousData := model.Conf, model.Decks, util.DataDir
	model.Conf, model.Decks, util.DataDir = model.NewAppConf(), map[string]*riff.Deck{}, t.TempDir()
	model.Conf.Flashcard = conf.NewFlashcard()
	model.Conf.Sync = conf.NewSync()
	t.Cleanup(func() { model.Conf, model.Decks, util.DataDir = previousConf, previousDecks, previousData })
	if err := os.MkdirAll(filepath.Join(util.DataDir, "storage", "riff"), 0755); err != nil {
		t.Fatal(err)
	}
	code, msg, data := riffContractRequest(t, "createRiffDeck", createRiffDeck, `{"name":" deck "}`)
	var deck apicontract.RiffDeck
	if err := json.Unmarshal(data, &deck); err != nil || code != 0 || deck.Name != " deck " || deck.Size != 0 || deck.ID == "" || len(deck.Created) != 19 || len(deck.Updated) != 19 {
		t.Fatalf("deck creation changed: %d %s %s, %v", code, msg, data, err)
	}
	code, msg, data = riffContractRequest(t, "renameRiffDeck", renameRiffDeck, `{"deckID":"`+deck.ID+`","name":" renamed "}`)
	if code != 0 || string(data) != "null" || model.Decks[deck.ID].Name != " renamed " {
		t.Fatalf("deck rename changed: %d %s %s", code, msg, data)
	}
	model.LoadFlashcards()
	code, msg, data = riffContractRequest(t, "getRiffDecks", getRiffDecks, "")
	var decks []apicontract.RiffDeck
	if err := json.Unmarshal(data, &decks); err != nil || code != 0 || len(decks) != 1 || decks[0].ID != deck.ID || decks[0].Name != " renamed " {
		t.Fatalf("persisted deck changed: %d %s %s, %v", code, msg, data, err)
	}
	code, msg, data = riffContractRequest(t, "removeRiffDeck", removeRiffDeck, `{"deckID":" `+deck.ID+` "}`)
	if code != -1 || string(data) != "null" || model.Decks[deck.ID] == nil {
		t.Fatalf("deck ID was unexpectedly trimmed: %d %s %s", code, msg, data)
	}
	code, msg, data = riffContractRequest(t, "removeRiffDeck", removeRiffDeck, `{"deckID":"`+deck.ID+`"}`)
	if code != 0 || string(data) != "null" || model.Decks[deck.ID] != nil {
		t.Fatalf("deck removal changed: %d %s %s", code, msg, data)
	}
	code, _, data = riffContractRequest(t, "getRiffDecks", getRiffDecks, "")
	if code != 0 || string(data) != "[]" {
		t.Fatalf("empty decks changed: %d %s", code, data)
	}
}

func TestAPIContractRiffAdmissionOrder(t *testing.T) {
	_, boxID := setupArchiveWorkspace(t)
	previous := model.Conf
	model.Conf = model.NewAppConf()
	t.Cleanup(func() { model.Conf = previous })
	for _, entry := range []struct {
		name     string
		handler  gin.HandlerFunc
		body     string
		language int
	}{
		{"getNotebookRiffCards", getNotebookRiffCards, `{"id":"` + boxID + `","page":false}`, 393},
		{"getNotebookRiffCards", getNotebookRiffCards, `{"id":"` + boxID + `"}`, 393},
		{"getNotebookRiffDueCards", getNotebookRiffDueCards, `{"notebook":"` + boxID + `","reviewedCards":null}`, 393},
		{"resetRiffCards", resetRiffCards, `{"type":"notebook","id":"` + boxID + `","deckID":"","blockIDs":[]}`, 393},
		{"getTreeRiffCards", getTreeRiffCards, `{"id":"missing","page":false}`, 180},
		{"getTreeRiffDueCards", getTreeRiffDueCards, `{"rootID":"missing"}`, 180},
		{"getRiffCardsByBlockIDs", getRiffCardsByBlockIDs, `{"blockIDs":["missing"]}`, 180},
		{"addRiffCards", addRiffCards, `{"deckID":"missing","blockIDs":["missing"]}`, 180},
		{"removeRiffCards", removeRiffCards, `{"deckID":"missing","blockIDs":["missing"]}`, 180},
	} {
		code, msg, data := riffContractRequest(t, entry.name, entry.handler, entry.body)
		if code != -1 || msg != model.Conf.Language(entry.language) || string(data) != "null" {
			t.Fatalf("%s admission changed: %d %s %s", entry.name, code, msg, data)
		}
	}
}

func TestAPIContractRiffInvalidBodies(t *testing.T) {
	for _, entry := range []struct {
		name    string
		handler gin.HandlerFunc
	}{
		{"createRiffDeck", createRiffDeck}, {"renameRiffDeck", renameRiffDeck}, {"removeRiffDeck", removeRiffDeck},
		{"addRiffCards", addRiffCards}, {"removeRiffCards", removeRiffCards}, {"getRiffDueCards", getRiffDueCards},
		{"getTreeRiffDueCards", getTreeRiffDueCards}, {"getNotebookRiffDueCards", getNotebookRiffDueCards},
		{"reviewRiffCard", reviewRiffCard}, {"skipReviewRiffCard", skipReviewRiffCard}, {"getRiffCards", getRiffCards},
		{"getTreeRiffCards", getTreeRiffCards}, {"getNotebookRiffCards", getNotebookRiffCards},
		{"resetRiffCards", resetRiffCards}, {"batchSetRiffCardsDueTime", batchSetRiffCardsDueTime}, {"getRiffCardsByBlockIDs", getRiffCardsByBlockIDs},
	} {
		code, msg, data := riffContractRequest(t, entry.name, entry.handler, "")
		if code != -1 || !strings.Contains(msg, "the request body is empty or truncated (EOF)") || string(data) != "null" {
			t.Fatalf("%s parse error changed: %d %s %s", entry.name, code, msg, data)
		}
	}
}
