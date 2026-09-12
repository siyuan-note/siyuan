package model

import (
	"encoding/json"
	flashcardv2 "github.com/siyuan-note/siyuan/kernel/flashcard"
	"testing"
)

func TestFlashcardHistoricalOcclusionsRequireExistingMarks(t *testing.T) {
	source := flashcardv2.CardSource{SourceType: "cloze", GenerationConfig: json.RawMessage(`{"occlusions":[{"id":"mark"}]}`)}
	refs := []flashcardv2.CardSourceRef{{EntityType: "block", EntityID: "block", Role: "content"}}
	if err := validateFlashcardV2HistoricalOcclusions(source, refs, func(string) string { return `<span>changed</span>` }); err == nil {
		t.Fatal("missing historical inline mark was accepted")
	}
	if err := validateFlashcardV2HistoricalOcclusions(source, refs, func(string) string { return `<span data-occlusion-id="mark">answer</span>` }); err != nil {
		t.Fatal(err)
	}
	refs[0].Role = "occlusion:mark"
	if err := validateFlashcardV2HistoricalOcclusions(source, refs, func(string) string { t.Fatal("whole block queried as inline mark"); return "" }); err != nil {
		t.Fatal(err)
	}
}
