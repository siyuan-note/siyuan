// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package flashcard

import (
	"reflect"
	"testing"
)

func TestPreviewAdvancedSourceWithoutStore(t *testing.T) {
	for _, mode := range []string{AdvancedModeCloze, AdvancedModeOrderedSingle, AdvancedModeOrderedCards, AdvancedModeChoiceSingle, AdvancedModeChoiceMultiple, AdvancedModeMultiLineAll, AdvancedModeMultiLineSteps, AdvancedModeTypedAnswer} {
		t.Run(mode, func(t *testing.T) {
			request := AdvancedSourceRequest{SourceID: "draft-source", Mode: mode, BlockIDs: []string{"question", "answer-a", "answer-b"}}
			if mode == AdvancedModeChoiceSingle || mode == AdvancedModeChoiceMultiple {
				request.CorrectOptionIndexes = []int{0}
			}
			before, _ := CanonicalJSON(request)
			models, err := PreviewAdvancedSource(request)
			if err != nil || len(models) == 0 {
				t.Fatalf("preview: %v", err)
			}
			again, err := PreviewAdvancedSource(request)
			if err != nil || !reflect.DeepEqual(models, again) {
				t.Fatalf("unstable preview: %v", err)
			}
			after, _ := CanonicalJSON(request)
			if string(before) != string(after) {
				t.Fatal("input mutated")
			}
			if request.validate() == nil {
				t.Fatal("save accepted missing operation/time")
			}
			for _, model := range models {
				if model.Schema.ID == "" || model.Card.ID == "" || model.Source.ID != request.SourceID || model.ReviewState.State != "new" {
					t.Fatalf("incomplete model: %+v", model)
				}
			}
		})
	}
}

func TestPreviewAdvancedSourceRejectsUnsupportedDrafts(t *testing.T) {
	base := AdvancedSourceRequest{SourceID: "draft", Mode: AdvancedModeCloze, BlockIDs: []string{"a"}}
	cases := []AdvancedSourceRequest{base, base, base, base, base}
	cases[0].DynamicDistractors = 1
	cases[1].DistractorQuery = &QueryAST{}
	cases[2].Mode = "plugin"
	cases[3].BlockIDs = make([]string, 1001)
	cases[4].SourceID = ""
	for _, request := range cases {
		if _, err := PreviewAdvancedSource(request); err == nil {
			t.Fatalf("accepted unsupported draft: %+v", request)
		}
	}
}
