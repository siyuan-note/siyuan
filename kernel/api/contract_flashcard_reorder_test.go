// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	flashcardv2 "github.com/siyuan-note/siyuan/kernel/flashcard"
	"github.com/siyuan-note/siyuan/kernel/model"
	"strings"
	"testing"
)

func TestAPIContractFlashcardReorder(t *testing.T) {
	endpoint := apicontract.ReorderAdvancedFlashcardSource.Definition()
	if endpoint.Authorization != apicontract.AuthenticatedAccess|apicontract.AdminAccess|apicontract.WritableAccess {
		t.Fatal("reorder permissions changed")
	}
	request, err := apicontract.ReorderAdvancedFlashcardSource.Decode(strings.NewReader(`{"operationID":"op","sourceID":"source","expectedRevisionID":"revision","orderedStepIDs":["b","a"],"updatedAt":42,"contentFingerprint":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}`))
	if err != nil {
		t.Fatal(err)
	}
	domain, err := convertFlashcardPayload[model.FlashcardV2ReorderSourceRequest](request)
	if err != nil || domain.Validate() != nil || domain.OrderedStepIDs[0] != "b" || domain.ContentFingerprint != strings.Repeat("a", 64) {
		t.Fatal("request conversion changed", err)
	}
	for _, body := range []string{`{"orderedStepIDs":"bad"}`, `{"updatedAt":false}`, `invalid`} {
		if _, err := apicontract.ReorderAdvancedFlashcardSource.Decode(strings.NewReader(body)); err == nil {
			t.Fatal("invalid shape accepted", body)
		}
	}
	compareFlashcardResponse[apicontract.FlashcardV2ReorderAdvancedSourceResult](t, "/api/flashcard/reorderAdvancedSource", flashcardv2.ReorderAdvancedSourceResult{UpdatedCardIDs: []string{}})
}

func TestAPIContractFlashcardOrderedDetails(t *testing.T) {
	endpoint := apicontract.GetOrderedFlashcardSourceDetails.Definition()
	if endpoint.Authorization != apicontract.AuthenticatedAccess|apicontract.AdminAccess {
		t.Fatal("details must be authenticated, admin, and read-only")
	}
	input, err := apicontract.GetOrderedFlashcardSourceDetails.Decode(strings.NewReader(`{"sourceID":"source"}`))
	if err != nil || input.SourceID != "source" {
		t.Fatal("details request", err)
	}
	compareFlashcardResponse[apicontract.FlashcardV2OrderedSourceDetails](t, "/api/flashcard/getOrderedSourceDetails", model.FlashcardV2OrderedSourceDetails{References: []flashcardv2.CardSourceRef{}, DOMs: map[string]string{}, ContentFingerprint: strings.Repeat("a", 64)})
}
