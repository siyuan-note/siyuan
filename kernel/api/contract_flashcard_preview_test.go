// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	flashcardv2 "github.com/siyuan-note/siyuan/kernel/flashcard"
	"github.com/siyuan-note/siyuan/kernel/model"
	"testing"
)

func TestAPIContractFlashcardDraftPreview(t *testing.T) {
	endpoint := apicontract.PreviewAdvancedFlashcardSource.Definition()
	if endpoint.Authorization != apicontract.AuthenticatedAccess|apicontract.AdminAccess {
		t.Fatal("preview permissions changed")
	}
	models, err := flashcardv2.PreviewAdvancedSource(flashcardv2.AdvancedSourceRequest{SourceID: "draft", Mode: flashcardv2.AdvancedModeCloze, BlockIDs: []string{"a"}})
	if err != nil {
		t.Fatal(err)
	}
	compareFlashcardResponse[apicontract.FlashcardV2AdvancedPreviewData](t, "/api/flashcard/previewAdvancedSource", model.FlashcardV2AdvancedPreview{Models: models, DOMs: map[string]string{"a": "<div>draft</div>"}})
}
