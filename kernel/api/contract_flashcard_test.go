package api

import (
	"encoding/json"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	flashcardv2 "github.com/siyuan-note/siyuan/kernel/flashcard"
	"github.com/siyuan-note/siyuan/kernel/model"
)

func TestAPIContractFlashcardQueryCompatibility(t *testing.T) {
	for _, body := range []string{
		`{}`, `null`, `{"QUERY":null,"OPTIONS":null,"unknown":1}`,
		`{"query":{"version":1,"root":{"operator":"matchAll"}},"options":{"now":1786431600000,"limit":0}}`,
		`{"query":{"version":1,"root":{"operator":"and","children":[{"operator":"predicate","field":"editLater","comparator":"equal","value":true},{"operator":"predicate","field":"cardID","comparator":"in","value":["a","b"]}]}}}`,
		`{"query":{"version":1,"root":{"operator":"predicate","field":"due","comparator":"equal","value":9007199254740993}}}`,
		`{"query":{"version":1,"root":{"operator":"matchAll","value":null}}}`,
		`{"query":{"root":{"operator":null,"children":[]}}}`, `{"options":{"now":1.5}}`,
		`{"query":"bad"}`, `{"options":{"limit":"bad"}}`, `{"query":{"root":{"children":true}}}`, `bad`,
	} {
		var legacy struct {
			Query   *flashcardv2.QueryAST         `json:"query"`
			Options flashcardv2.CardSearchOptions `json:"options"`
		}
		oldErr := json.NewDecoder(strings.NewReader(body)).Decode(&legacy)
		request, err := apicontract.QueryFlashcards.Decode(strings.NewReader(body))
		if (oldErr != nil) != (err != nil) {
			t.Fatalf("binding changed for %s: old=%v new=%v", body, oldErr, err)
		}
		if err != nil {
			continue
		}
		if (request.Query == nil) != (legacy.Query == nil) {
			t.Fatalf("null query changed: %s", body)
		}
		if request.Query != nil {
			root, convertErr := flashcardQueryExpression(request.Query.Root)
			oldJSON, _ := json.Marshal(legacy.Query.Root)
			newJSON, _ := json.Marshal(root)
			if convertErr != nil || string(oldJSON) != string(newJSON) {
				t.Fatalf("query changed: %s != %s: %v", oldJSON, newJSON, convertErr)
			}
		}
		oldJSON, _ := json.Marshal(legacy.Options)
		newJSON, _ := json.Marshal(request.Options)
		if string(oldJSON) != string(newJSON) {
			t.Fatalf("options changed: %s != %s", oldJSON, newJSON)
		}
	}
}

func TestAPIContractFlashcardSearchSerialization(t *testing.T) {
	item := model.FlashcardV2CardSearchResult{CardSearchResult: flashcardv2.CardSearchResult{
		Card: flashcardv2.Card{ID: "card", SourceID: "source", TemplateID: "template", VariantKey: "forward",
			VariantData: json.RawMessage(`{"number":9007199254740993}`), GenerationStatus: flashcardv2.GenerationActive,
			Flag: 2, PresetOverrideID: "preset", PriorityOverride: "learning", CreatedAt: 123, UpdatedAt: 456,
			EditLater: &flashcardv2.CardEditLater{Note: "修改题目\n<script>", UpdatedAt: 456}},
		ReviewState: flashcardv2.ReviewState{CardID: "card", ReviewStateSnapshot: flashcardv2.ReviewStateSnapshot{
			State: "review", Due: 1786431600000, LastReview: 123, Stability: 1.5, Difficulty: 2.5,
			ElapsedDays: 5, ScheduledDays: 6, Reps: 7, Lapses: 8, Suspended: true, BuriedUntil: 999,
			BuriedReason: "manual", StateRevisionID: "state"}},
		SourceType: "qa", SourceStatus: "active", SourcePriority: "learning", InheritedPriority: "retaining",
		DefaultPresetID: "default", CardTagIDs: []string{"tag"}, SourceTagIDs: []string{},
		EffectiveTagIDs: []string{"tag"}, EffectivePriority: "learning", EffectivePresetID: "preset",
		SourceNotebookID: "notebook", SourceRootID: "doc", SourcePath: "/doc.sy", SourceAvailable: true,
	}, SourceBlockID: "block", SourceTitle: "卡片"}
	for _, items := range [][]model.FlashcardV2CardSearchResult{{}, {{}}, {item}} {
		data, err := flashcardSearchData(items)
		if err != nil {
			t.Fatal(err)
		}
		got, _ := json.Marshal(data)
		want, _ := json.Marshal(map[string]interface{}{"cards": items})
		decode := func(payload []byte) interface{} {
			decoder := json.NewDecoder(strings.NewReader(string(payload)))
			decoder.UseNumber()
			var value interface{}
			if err := decoder.Decode(&value); err != nil {
				t.Fatal(err)
			}
			return value
		}
		if !reflect.DeepEqual(decode(got), decode(want)) {
			t.Fatalf("search serialization changed: %s != %s", got, want)
		}
		engine := gin.New()
		engine.POST("/api/flashcard/queryCards", contractHandler(apicontract.QueryFlashcards,
			func(c *gin.Context, request apicontract.QueryFlashcardsRequest) apicontract.Response[apicontract.QueryFlashcardsData] {
				return apicontract.Success(data)
			}))
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, httptest.NewRequest("POST", "/api/flashcard/queryCards", strings.NewReader(`{}`)))
		requireAPIContract(t, "POST", "/api/flashcard/queryCards", recorder)
	}
}

func TestAPIContractFlashcardEditLaterSerializationAndMalformedRequests(t *testing.T) {
	bundle, err := apicontract.BuildBundle()
	if err != nil {
		t.Fatal(err)
	}
	for _, body := range []string{
		`{}`, `null`,
		`{"operationID":"op","cardID":"card","changedAt":1}`,
		`{"operationID":"op","cardID":"card","changedAt":1,"enabled":null}`,
		`{"operationID":"op","cardID":"card","changedAt":1,"enabled":"false"}`,
	} {
		if _, err = apicontract.SetFlashcardEditLater.Decode(strings.NewReader(body)); err == nil {
			t.Fatalf("invalid edit-later request accepted: %s", body)
		}
	}
	for _, enabled := range []string{"true", "false"} {
		body := `{"operationID":"op","cardID":"card","changedAt":1,"enabled":` + enabled + `}`
		if _, err = apicontract.SetFlashcardEditLater.Decode(strings.NewReader(body)); err != nil {
			t.Fatalf("valid edit-later request rejected: %s: %v", body, err)
		}
	}
	for _, pending := range []*flashcardv2.CardEditLater{nil, {Note: "", UpdatedAt: 123}, {Note: "修改\n📝", UpdatedAt: 456}} {
		result := flashcardv2.CardEditLaterResult{CardID: "card", RevisionID: "revision", EditLater: pending}
		data := flashcardEditLaterData(result)
		got, _ := json.Marshal(data)
		want, _ := json.Marshal(result)
		if string(got) != string(want) {
			t.Fatalf("edit-later serialization changed: %s != %s", got, want)
		}
		payload, _ := json.Marshal(apicontract.Success(data))
		if err = bundle.ValidateResponse("POST", "/api/flashcard/setCardEditLater", payload); err != nil {
			t.Fatal(err)
		}
	}
	for _, entry := range []struct {
		path    string
		handler gin.HandlerFunc
	}{{"queryCards", queryFlashcards}, {"setCardEditLater", setFlashcardEditLater}} {
		engine := gin.New()
		path := "/api/flashcard/" + entry.path
		engine.POST(path, entry.handler)
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, httptest.NewRequest("POST", path, strings.NewReader(`{"`)))
		requireAPIContract(t, "POST", path, recorder)
		if !strings.Contains(recorder.Body.String(), `"code":-1`) {
			t.Fatalf("malformed request accepted: %s", recorder.Body.String())
		}
	}
}
