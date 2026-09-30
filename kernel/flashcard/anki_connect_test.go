package flashcard

import (
	"context"
	"reflect"
	"testing"
)

func TestAnkiConnectIncrementalUpdatesPreserveOtherNotesAndReviewState(t *testing.T) {
	ctx := context.Background()
	store := newGenerationTestStore(t, ctx)
	defer store.Close()
	now := int64(1786431600000)
	applyGenerationEntities(t, ctx, store, "preset", now, testSchedulerPreset(legacyPresetID, false, false))
	deckID, err := store.CreateAnkiConnectDeck(ctx, "Words", now)
	if err != nil {
		t.Fatal(err)
	}
	if again, err := store.CreateAnkiConnectDeck(ctx, "Words", now+1); err != nil || again != deckID {
		t.Fatalf("deck creation is not idempotent: %d %v", again, err)
	}
	writer := &ankiImportTestWriter{}
	input := AnkiConnectNoteInput{DeckName: "Words", ModelName: "Basic",
		Fields: map[string]string{"Front": "first", "Back": "answer"}, Tags: []string{"aictionary", "ai"}}
	firstID, err := store.UpsertAnkiConnectNote(ctx, input, nil, writer, now+2)
	if err != nil {
		t.Fatal(err)
	}
	input.Fields["Front"] = "second"
	if _, err = store.UpsertAnkiConnectNote(ctx, input, nil, writer, now+3); err != nil {
		t.Fatal(err)
	}
	notes, err := store.AnkiConnectNotes(ctx)
	if err != nil || len(notes) != 2 {
		t.Fatalf("incremental creation retired other notes: %+v %v", notes, err)
	}
	var first AnkiConnectStoredNote
	for _, note := range notes {
		if note.Config.NoteID == firstID {
			first = note
		}
	}
	variant := first.Config.Variants[0]
	cardID := GeneratedCardID(first.Source.ID, variant.TemplateID, variant.Key)
	if _, err = store.ReviewCard(ctx, ReviewRequest{OperationID: "review", CardID: cardID,
		Rating: ReviewGood, ReviewedAt: now + 1000, DurationMS: 500, ReviewMode: "normal"}); err != nil {
		t.Fatal(err)
	}
	before, found, err := store.projection.CurrentEntity(ctx, EntityReviewState, cardID)
	if err != nil || !found {
		t.Fatalf("state missing: %v %v", found, err)
	}
	input.Fields["Front"], input.Fields["Back"] = "first edited", "answer edited"
	if id, err := store.UpsertAnkiConnectNote(ctx, input, &first, writer, now+2000); err != nil || id != firstID {
		t.Fatalf("update changed note identity: %d %v", id, err)
	}
	after, found, err := store.projection.CurrentEntity(ctx, EntityReviewState, cardID)
	if err != nil || !found || !reflect.DeepEqual(before, after) {
		t.Fatalf("update changed review state: %v %v", found, err)
	}
	history, err := store.projection.CardHistory(ctx, cardID, 100, 0)
	if err != nil || len(history) != 1 {
		t.Fatalf("update changed review history: %+v %v", history, err)
	}
	notes, err = store.AnkiConnectNotes(ctx)
	if err != nil || len(notes) != 2 {
		t.Fatalf("update retired unrelated notes: %+v %v", notes, err)
	}
	for _, note := range notes {
		if note.Config.NoteID == firstID && !reflect.DeepEqual(note.Config.Variants, first.Config.Variants) {
			t.Fatal("field update changed card identity")
		}
	}
	if _, err = store.ImportAnkiPackage(ctx, AnkiImportRequest{OperationID: "package", PackagePath: createAnkiImportPackageForTest(t),
		TargetID: "notebook", ImportedAt: now + 3000, Writer: writer}); err != nil {
		t.Fatal(err)
	}
	notes, err = store.AnkiConnectNotes(ctx)
	if err != nil || len(notes) != 2 {
		t.Fatalf("package import retired live notes: %+v %v", notes, err)
	}
}

func TestAnkiConnectClozeAndMediaOnlyQuestions(t *testing.T) {
	ctx := context.Background()
	store := newGenerationTestStore(t, ctx)
	defer store.Close()
	applyGenerationEntities(t, ctx, store, "preset", 1, testSchedulerPreset(legacyPresetID, false, false))
	if _, err := store.CreateAnkiConnectDeck(ctx, "Words", 1); err != nil {
		t.Fatal(err)
	}
	for _, input := range []AnkiConnectNoteInput{
		{DeckName: "Words", ModelName: "Basic", Fields: map[string]string{"Front": `<img src="assets/image.png">`, "Back": "picture"}},
		{DeckName: "Words", ModelName: "Cloze", Fields: map[string]string{"Text": "{{c1::one}} and {{c2::two}}", "Back Extra": "hint"}},
	} {
		if _, err := store.UpsertAnkiConnectNote(ctx, input, nil, &ankiImportTestWriter{}, 2); err != nil {
			t.Fatal(err)
		}
	}
	cards, err := store.projection.SearchCards(ctx, nil, CardSearchOptions{Now: 3})
	if err != nil || len(cards) != 3 {
		t.Fatalf("media or cloze cards missing: %+v %v", cards, err)
	}
}

func TestAnkiConnectQuestionConditionsAndClozeFields(t *testing.T) {
	if NormalizeAnkiConnectField(`<img src="assets/a.png">`) == NormalizeAnkiConnectField(`<img src="assets/b.png">`) || NormalizeAnkiConnectField(`[sound:a.mp3]`) != NormalizeAnkiConnectField(`<audio src="assets/a.mp3"></audio>`) {
		t.Fatal("duplicate comparison dropped media identity")
	}
	fields := map[string]string{"Front": "question", "Back": ""}
	if ankiConnectQuestionHasContent("{{#Back}}{{Front}}{{/Back}}", fields) || !ankiConnectQuestionHasContent("{{^Back}}{{text:Front}}{{/Back}}", fields) {
		t.Fatal("conditional question generation ignored empty fields")
	}
	ctx := context.Background()
	store := newGenerationTestStore(t, ctx)
	defer store.Close()
	if err := store.ValidateAnkiConnectFields(ctx, "Cloze", map[string]string{"Text": "no cloze", "Back Extra": "{{c1::hint}}"}); err == nil {
		t.Fatal("cloze outside the question generated a card")
	}
}

func TestAnkiConnectRestoredVariantPreservesIdentity(t *testing.T) {
	ctx := context.Background()
	store := newGenerationTestStore(t, ctx)
	defer store.Close()
	applyGenerationEntities(t, ctx, store, "preset", 1, testSchedulerPreset(legacyPresetID, false, false))
	if _, err := store.CreateAnkiConnectDeck(ctx, "Words", 1); err != nil {
		t.Fatal(err)
	}
	input := AnkiConnectNoteInput{DeckName: "Words", ModelName: "Basic (and reversed card)", Fields: map[string]string{"Front": "question", "Back": "answer"}}
	writer := &ankiImportTestWriter{}
	if _, err := store.UpsertAnkiConnectNote(ctx, input, nil, writer, 2); err != nil {
		t.Fatal(err)
	}
	before, err := store.AnkiConnectNotes(ctx)
	if err != nil {
		t.Fatal(err)
	}
	input.Fields["Back"] = ""
	if _, err = store.UpsertAnkiConnectNote(ctx, input, &before[0], writer, 3); err != nil {
		t.Fatal(err)
	}
	inactive, err := store.AnkiConnectNotes(ctx)
	if err != nil || len(inactive[0].Config.Variants) != 1 {
		t.Fatalf("reverse variant stayed active: %+v %v", inactive, err)
	}
	input.Fields["Back"] = "answer restored"
	if _, err = store.UpsertAnkiConnectNote(ctx, input, &inactive[0], writer, 4); err != nil {
		t.Fatal(err)
	}
	after, err := store.AnkiConnectNotes(ctx)
	if err != nil || !reflect.DeepEqual(before[0].Config.Variants, after[0].Config.Variants) {
		t.Fatalf("restoration changed card identity: %+v %v", after, err)
	}
}
