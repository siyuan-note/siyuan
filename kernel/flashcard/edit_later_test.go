package flashcard

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"testing"
)

func editLaterTestCards(t *testing.T) (*Store, string, string, int64) {
	t.Helper()
	ctx := context.Background()
	store := newGenerationTestStore(t, ctx)
	t.Cleanup(func() { store.Close() })
	now := int64(1786431600000)
	source := testGenerationSource("edit-later-source", "edit-later-schema", "qa", json.RawMessage(`{}`))
	preset := testSchedulerPreset("edit-later-preset", false, false)
	source.DefaultPresetID = preset.ID
	applyGenerationEntities(t, ctx, store, "edit-later-setup", now,
		testGenerationSchema(source.SchemaID, []string{"forward", "reverse"}),
		testGenerationTemplate("forward", source.SchemaID, GenerationStatic, "forward", true),
		testGenerationTemplate("reverse", source.SchemaID, GenerationStatic, "reverse", true), source, preset)
	if _, err := store.ReconcileSourceCards(ctx, "edit-later-generate", source.ID, now); err != nil {
		t.Fatal(err)
	}
	return store, GeneratedCardID(source.ID, "forward", "forward"), GeneratedCardID(source.ID, "reverse", "reverse"), now
}

func TestCardEditLaterPreservesSchedulingSiblingsAndSurvivesRebuild(t *testing.T) {
	ctx := context.Background()
	store, cardID, siblingID, now := editLaterTestCards(t)
	for index, request := range []CardManagementRequest{
		{Action: CardActionSetDue, Due: now + 86400000},
		{Action: CardActionSuspend},
		{Action: CardActionBury, BuriedUntil: now + 90000000, Reason: "manual"},
	} {
		request.OperationID, request.CardIDs, request.ChangedAt = request.Action, []string{cardID}, now+int64(index)+1
		if _, err := store.ManageCards(ctx, request); err != nil {
			t.Fatal(err)
		}
	}
	before, _, _ := store.Projection().CurrentEntity(ctx, EntityReviewState, cardID)
	sibling, _, _ := store.Projection().CurrentEntity(ctx, EntityCard, siblingID)
	request := SetCardEditLaterRequest{OperationID: "edit-later-mark", CardID: cardID, Enabled: true,
		Note: "拆分问题\n保留必要上下文 <script>", ChangedAt: now + 100}
	marked, err := store.SetCardEditLater(ctx, request)
	if err != nil || marked.EditLater == nil || marked.EditLater.Note != request.Note {
		t.Fatalf("mark edit later: %#v %v", marked, err)
	}
	if _, err = store.ReconcileSourceCards(ctx, "edit-later-reconcile", "edit-later-source", now+200); err != nil {
		t.Fatal(err)
	}
	if err = store.RebuildProjection(ctx); err != nil {
		t.Fatal(err)
	}
	retried, err := store.SetCardEditLater(ctx, request)
	if err != nil || !reflect.DeepEqual(retried, marked) {
		t.Fatalf("retry after rebuild: %#v %v", retried, err)
	}
	query := &QueryAST{Version: 1, Root: QueryExpression{Operator: QueryPredicate,
		Field: "editLater", Comparator: QueryEqual, Value: json.RawMessage(`true`)}}
	results, err := store.Projection().SearchCards(ctx, query, CardSearchOptions{
		Now: now + 300, IncludeInactive: true, IncludeSuspended: true, IncludeBuried: true,
	})
	if err != nil || len(results) != 1 || results[0].Card.ID != cardID || results[0].Card.EditLater.Note != request.Note {
		t.Fatalf("pending edits after rebuild: %#v %v", results, err)
	}
	completed, err := store.SetCardEditLater(ctx, SetCardEditLaterRequest{
		OperationID: "edit-later-complete", CardID: cardID, ChangedAt: now + 400,
	})
	if err != nil || completed.EditLater != nil {
		t.Fatalf("complete: %#v %v", completed, err)
	}
	after, _, _ := store.Projection().CurrentEntity(ctx, EntityReviewState, cardID)
	siblingAfter, _, _ := store.Projection().CurrentEntity(ctx, EntityCard, siblingID)
	if !reflect.DeepEqual(before, after) || !reflect.DeepEqual(sibling, siblingAfter) {
		t.Fatal("editing changed the schedule, availability or sibling card")
	}
}

func TestCardEditLaterExcludesNewAndOpenSessionsAndRejectsStaleReviews(t *testing.T) {
	ctx := context.Background()
	store, cardID, siblingID, now := editLaterTestCards(t)
	for _, mode := range []string{"normal", "reinforcement"} {
		_, err := store.StartStudySession(ctx, StudyQueueRequest{
			OperationID: "start-" + mode, SessionID: mode, ReviewMode: mode, Now: now + 1, NewLimit: 20, ReviewLimit: 100,
		})
		if err != nil {
			t.Fatal(err)
		}
	}
	if _, err := store.SetCardEditLater(ctx, SetCardEditLaterRequest{
		OperationID: "mark", CardID: cardID, Enabled: true, ChangedAt: now + 2,
	}); err != nil {
		t.Fatal(err)
	}
	for _, mode := range []string{"normal", "reinforcement"} {
		queue, err := store.Projection().SessionQueueAt(ctx, mode, StudyDayOptions{Now: now + 3})
		if err != nil || len(queue) != 2 {
			t.Fatalf("open session: %#v %v", queue, err)
		}
		for _, item := range queue {
			if item.Card.ID == cardID && (item.SessionCard.Status != "skipped" || item.RepeatDue != 0) {
				t.Fatalf("pending card still in %s session: %#v", mode, item)
			}
		}
		if _, err = store.ReviewCard(ctx, ReviewRequest{
			OperationID: "review-" + mode, CardID: cardID, SessionID: mode, ReviewMode: mode,
			ReviewedAt: now + 4, Rating: ReviewGood,
		}); err == nil {
			t.Fatalf("accepted stale %s review", mode)
		}
		fresh, err := store.StartStudySession(ctx, StudyQueueRequest{
			OperationID: "fresh-" + mode, SessionID: "fresh-" + mode, ReviewMode: mode, Now: now + 5, NewLimit: 20, ReviewLimit: 100,
		})
		if err != nil || len(fresh.SessionCards) != 1 || fresh.SessionCards[0].CardID != siblingID {
			t.Fatalf("new %s session: %#v %v", mode, fresh, err)
		}
	}
	if _, err := store.SetCardEditLater(ctx, SetCardEditLaterRequest{
		OperationID: "complete", CardID: cardID, ChangedAt: now + 6,
	}); err != nil {
		t.Fatal(err)
	}
	queue, err := store.Projection().SessionQueueAt(ctx, "normal", StudyDayOptions{Now: now + 7})
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range queue {
		if item.Card.ID == cardID && item.SessionCard.Status != "queued" {
			t.Fatalf("completion did not restore eligible card: %#v", item)
		}
	}
}

func TestCardEditLaterRetryValidationAndConcurrentUpdates(t *testing.T) {
	ctx := context.Background()
	store, cardID, _, now := editLaterTestCards(t)
	revision, _, _ := store.Projection().CurrentEntity(ctx, EntityCard, cardID)
	request := SetCardEditLaterRequest{OperationID: "mark", CardID: cardID, Enabled: true,
		ChangedAt: now + 100, ExpectedRevisionID: revision.RevisionID}
	if _, err := store.SetCardEditLater(ctx, request); err != nil {
		t.Fatal(err)
	}
	changed := request
	changed.Note = "changed"
	if _, err := store.SetCardEditLater(ctx, changed); !errors.Is(err, ErrOperationConflict) {
		t.Fatalf("conflicting retry: %v", err)
	}
	changed.OperationID = "concurrent"
	if _, err := store.SetCardEditLater(ctx, changed); !errors.Is(err, ErrRevisionConflict) {
		t.Fatalf("stale revision: %v", err)
	}
	for _, invalid := range []SetCardEditLaterRequest{
		{OperationID: "no-card", Enabled: true, ChangedAt: now},
		{OperationID: "long", CardID: cardID, Enabled: true, ChangedAt: now, Note: strings.Repeat("字", 4001)},
		{OperationID: "complete-note", CardID: cardID, ChangedAt: now, Note: "must not erase this note silently"},
	} {
		if _, err := store.SetCardEditLater(ctx, invalid); err == nil {
			t.Fatalf("accepted invalid edit-later request: %s", invalid.OperationID)
		}
	}
}
