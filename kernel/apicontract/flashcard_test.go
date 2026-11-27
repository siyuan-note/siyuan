// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package apicontract

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestQuickFlashcardSourcesContract(t *testing.T) {
	for _, body := range []string{
		`{"operationID":"op","blockIDs":["block"],"createdAt":1,"toggle":true}`,
		`{"OperationID":"op","BlockIDs":["block"],"CreatedAt":1,"Toggle":true,"unknown":1}`,
	} {
		request, err := CreateQuickFlashcardSources.Decode(strings.NewReader(body))
		if err != nil || request.OperationID != "op" || len(request.BlockIDs) != 1 || !request.Toggle {
			t.Fatalf("struct binding changed: %+v, %v", request, err)
		}
	}
	for _, body := range []string{`null`, `{}`, `{"blockIDs":null,"toggle":null}`} {
		if _, err := CreateQuickFlashcardSources.Decode(strings.NewReader(body)); err != nil {
			t.Fatalf("business validation must remain in the model: %v", err)
		}
	}
	for _, body := range []string{``, `{`, `{"createdAt":1.5}`, `{"blockIDs":[1]}`} {
		_, err := CreateQuickFlashcardSources.Decode(strings.NewReader(body))
		if err == nil {
			t.Fatalf("invalid request accepted: %s", body)
		}
		payload, _ := json.Marshal(CreateQuickFlashcardSources.DecodeFailure(err))
		if !strings.Contains(string(payload), "invalid flashcard request: ") {
			t.Fatalf("decode error prefix changed: %s", payload)
		}
	}
	bundle, err := BuildBundle()
	if err != nil {
		t.Fatal(err)
	}
	for _, data := range []QuickFlashcardSourcesData{
		{SourceIDs: []string{}, CardIDs: []string{}, Action: "created"},
		{SourceIDs: []string{"source"}, CardIDs: []string{"card"}, Action: "created", MarkedBlockIDs: &[]string{"block"}},
		{SourceIDs: []string{"source"}, CardIDs: []string{"card"}, Action: "removed", MarkedBlockIDs: &[]string{}},
	} {
		payload, _ := json.Marshal(Success(data))
		if err = bundle.ValidateResponse("POST", "/api/flashcard/createQuickSources", payload); err != nil {
			t.Fatal(err)
		}
	}
}

func TestFlashcardRenderRatingIntervalsContract(t *testing.T) {
	for _, body := range []string{`{"cardID":"card"}`, `{"cardID":"card","includeRatingIntervals":true}`} {
		request, err := GetFlashcardRenderModel.Decode(strings.NewReader(body))
		if err != nil || request.CardID != "card" || request.IncludeRatingIntervals != strings.Contains(body, "true") {
			t.Fatalf("invalid render request: %+v, %v", request, err)
		}
	}
	bundle, err := BuildBundle()
	if err != nil {
		t.Fatal(err)
	}
	intervalSchema := bundle.Definitions["FlashcardV2CardRenderModel"].Properties["ratingIntervals"]
	for _, intervals := range []map[string]string{nil, {"again": "1 min", "hard": "5 min", "good": "10 min", "easy": "4 days"}} {
		payload, err := json.Marshal(FlashcardV2CardRenderModel{RatingIntervals: intervals})
		if err != nil {
			t.Fatal(err)
		}
		var fields map[string]any
		if err = json.Unmarshal(payload, &fields); err != nil {
			t.Fatal(err)
		}
		value, present := fields["ratingIntervals"]
		if present != (intervals != nil) {
			t.Fatalf("unexpected rating interval presence: %s", payload)
		}
		if present {
			if err = bundle.validate(intervalSchema, value, "$.ratingIntervals"); err != nil {
				t.Fatal(err)
			}
		}
	}
}
