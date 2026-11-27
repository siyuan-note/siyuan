// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"encoding/json"
	"math"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	flashcardv2 "github.com/siyuan-note/siyuan/kernel/flashcard"
	"github.com/siyuan-note/siyuan/kernel/model"
)

// compareFlashcardRequest 验证类型契约保留业务结构体绑定的输入语义及原始 JSON 精度。
func compareFlashcardRequest[Request, Data, Legacy any](t *testing.T, endpoint apicontract.Endpoint[Request, Data], bodies []string) {
	t.Helper()
	for _, body := range append(bodies, `{}`, `null`, `{"unknown":true}`, ``, `{`, `[]`) {
		var legacy Legacy
		oldErr := json.NewDecoder(strings.NewReader(body)).Decode(&legacy)
		request, err := endpoint.Decode(strings.NewReader(body))
		if (oldErr != nil) != (err != nil) {
			t.Fatalf("%s input compatibility changed for %s: %v != %v", endpoint.Definition().Path, body, oldErr, err)
		}
		if err != nil {
			continue
		}
		converted, err := convertFlashcardPayload[Legacy](request)
		if err != nil || !reflect.DeepEqual(legacy, converted) {
			t.Fatalf("%s input changed for %s: %#v != %#v (%v)", endpoint.Definition().Path, body, legacy, converted, err)
		}
	}
}

func TestAPIContractFlashcardMigratedRequestCompatibility(t *testing.T) {
	compareFlashcardRequest[apicontract.FlashcardV2BasicSourceRequest, apicontract.FlashcardV2BasicSourceResult, flashcardv2.BasicSourceRequest](t,
		apicontract.CreateBasicFlashcardSource, []string{`{"OperationID":"op","BlockIDs":["block"],"createdAt":1,"bidirectional":null}`, `{"createdAt":1.5}`})
	compareFlashcardRequest[apicontract.FlashcardV2AdvancedSourceRequest, apicontract.FlashcardV2AdvancedSourceResult, flashcardv2.AdvancedSourceRequest](t,
		apicontract.CreateAdvancedFlashcardSource, []string{`{"mode":"choice","distractorQuery":{"version":1,"root":{"operator":"predicate","value":9007199254740993}}}`})
	compareFlashcardRequest[apicontract.FlashcardV2MutateFlashcardEntitiesRequest, apicontract.FlashcardV2EntityMutationResult, mutateFlashcardEntitiesRequest](t,
		apicontract.MutateFlashcardEntities, []string{`{"operationID":"op","mutations":[{"entityType":"source","payload":{"n":9007199254740993}},{"payload":null},{}]}`})
	compareFlashcardRequest[apicontract.FlashcardV2ReviewRequest, apicontract.FlashcardV2ReviewResult, flashcardv2.ReviewRequest](t,
		apicontract.ReviewFlashcard, []string{`{"cardID":"card","answerResult":{"n":9007199254740993}}`, `{"answerResult":null}`, `{"rating":42}`})
	compareFlashcardRequest[apicontract.FlashcardV2StudyQueueRequest, apicontract.FlashcardV2StudyQueueResult, flashcardv2.StudyQueueRequest](t,
		apicontract.StartFlashcardSession, []string{`{"ReviewSetID":"set","newLimit":0,"query":null}`, `{"now":null,"includeSuspended":null}`})
	compareFlashcardRequest[apicontract.FlashcardV2GetFlashcardSessionQueueRequest, apicontract.FlashcardV2QueueData, getFlashcardSessionQueueRequest](t,
		apicontract.GetFlashcardSessionQueue, []string{`{"sessionID":"session","now":123,"reviewDayStart":1,"reviewDayEnd":2}`})
	for _, entry := range []struct {
		body string
		want int
	}{{`{}`, 50}, {`null`, 50}, {`{"limit":null}`, 50}, {`{"limit":0}`, 0}, {`{"LIMIT":25}`, 25}} {
		request, err := apicontract.GetFlashcardSourceHistory.Decode(strings.NewReader(entry.body))
		if err != nil || request.Limit != entry.want {
			t.Fatalf("history default changed: %s: %+v (%v)", entry.body, request, err)
		}
	}
}

func compareFlashcardResponse[Data, Legacy any](t *testing.T, path string, legacy Legacy) {
	t.Helper()
	actual, err := json.Marshal(flashcardPayloadResponse[Data](legacy))
	if err != nil {
		t.Fatal(err)
	}
	expected, err := json.Marshal(apicontract.Success(legacy))
	if err != nil {
		t.Fatal(err)
	}
	if string(actual) != string(expected) {
		t.Fatalf("%s response changed: %s != %s", path, actual, expected)
	}
	bundle, err := apicontract.BuildBundle()
	if err != nil {
		t.Fatal(err)
	}
	if err = bundle.ValidateResponse(http.MethodPost, path, actual); err != nil {
		t.Fatalf("%s response violates its contract: %v", path, err)
	}
}

func TestAPIContractFlashcardMigratedResponseCompatibility(t *testing.T) {
	compareFlashcardResponse[apicontract.FlashcardV2EntityRevision](t, "/api/flashcard/restoreSourceHistory",
		flashcardv2.EntityRevision{Payload: json.RawMessage(`{"n":9007199254740993}`)})
	compareFlashcardResponse[apicontract.FlashcardV2ReviewResult](t, "/api/flashcard/reviewCard", flashcardv2.ReviewResult{})
	compareFlashcardResponse[apicontract.FlashcardV2StatisticsResult](t, "/api/flashcard/getStatistics", flashcardv2.StatisticsResult{})
	point := flashcardv2.StatisticsDistributionPoint{Min: 1, Max: math.Inf(1), Count: 2}
	converted, err := convertFlashcardPayload[apicontract.FlashcardV2StatisticsDistributionPoint](point)
	if err != nil || converted.Max != nil || converted.Min != 1 || converted.Count != 2 {
		t.Fatalf("open distribution interval changed: %+v (%v)", converted, err)
	}
	for _, data := range []apicontract.FlashcardV2SourceHistoryData{
		{}, {Versions: []apicontract.FlashcardV2EntityRevision{}},
		{Version: &apicontract.FlashcardV2SourceHistoryVersion{}},
	} {
		payload, err := json.Marshal(apicontract.Success(data))
		if err != nil {
			t.Fatal(err)
		}
		bundle, err := apicontract.BuildBundle()
		if err != nil {
			t.Fatal(err)
		}
		if err = bundle.ValidateResponse("POST", "/api/flashcard/getSourceHistory", payload); err != nil {
			t.Fatalf("history response variant failed: %s (%v)", payload, err)
		}
	}
	compareFlashcardResponse[apicontract.FlashcardV2SourceHistoryVersion](t, "/api/flashcard/getSourceHistory", model.FlashcardV2SourceHistoryVersion{})
}

func TestAPIContractFlashcardMigratedMalformedRequestsAndUploadLimit(t *testing.T) {
	for _, entry := range []struct {
		path    string
		handler gin.HandlerFunc
	}{{"createBasicSource", createBasicFlashcardSource}, {"createAdvancedSource", createAdvancedFlashcardSource},
		{"mutateEntities", mutateFlashcardEntities}, {"startSession", startFlashcardSession},
		{"reviewCard", reviewFlashcard}, {"getSourceHistory", getFlashcardSourceHistory},
		{"deleteInvalidSources", deleteInvalidFlashcardSources}} {
		path := "/api/flashcard/" + entry.path
		engine := gin.New()
		engine.POST(path, entry.handler)
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, httptest.NewRequest("POST", path, strings.NewReader(`{`)))
		requireAPIContract(t, "POST", path, recorder)
		if !strings.Contains(recorder.Body.String(), `invalid flashcard request: unexpected EOF`) {
			t.Fatalf("malformed request behavior changed: %s", recorder.Body.String())
		}
	}
	engine := gin.New()
	path := "/api/flashcard/importAnkiPackage"
	engine.POST(path, importAnkiFlashcardPackage)
	request := httptest.NewRequest("POST", path, http.NoBody)
	request.ContentLength = flashcardv2.MaxAnkiPackageArchiveSize + maxAnkiMultipartOverhead + 1
	recorder := httptest.NewRecorder()
	engine.ServeHTTP(recorder, request)
	requireAPIContract(t, "POST", path, recorder)
	if !strings.Contains(recorder.Body.String(), "Anki package upload exceeds its size limit") {
		t.Fatalf("upload limit must precede multipart parsing: %s", recorder.Body.String())
	}
}
