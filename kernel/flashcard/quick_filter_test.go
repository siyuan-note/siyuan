package flashcard

import (
	"context"
	"reflect"
	"testing"
)

func TestQuickSourceEmptyBlocksPreserveCancellationAndState(t *testing.T) {
	ctx := context.Background()
	store := newGenerationTestStore(t, ctx)
	defer store.Close()
	now := int64(1786431600000)
	setupLegacyCompatibilityBuiltins(t, ctx, store, now)
	if _, err := store.CreateQuickSources(ctx, QuickSourceRequest{OperationID: "existing-empty",
		BlockIDs: []string{"existing"}, CreatedAt: now + 1}); err != nil {
		t.Fatal(err)
	}
	cardID := LegacyQuickCardID("existing")
	if _, err := store.ManageCards(ctx, CardManagementRequest{OperationID: "empty-due", CardIDs: []string{cardID},
		Action: CardActionSetDue, ChangedAt: now + 2, Due: now + 86400000}); err != nil {
		t.Fatal(err)
	}
	empty := map[string]bool{"blank": true, "existing": true}
	for _, test := range []struct {
		name   string
		ids    []string
		toggle bool
		want   []string
	}{
		{"single", []string{"blank"}, true, []string{}},
		{"all blank", []string{"blank", "blank"}, false, []string{}},
		{"mixed creation", []string{"blank", "existing", "text", "text"}, false, []string{"text"}},
		{"mixed toggle", []string{"blank", "existing", "text"}, true, []string{"existing", "text"}},
		{"cancel existing", []string{"blank", "existing"}, true, []string{"existing"}},
	} {
		t.Run(test.name, func(t *testing.T) {
			ids, err := store.FilterQuickSourceBlocks(ctx, test.ids, empty, test.toggle)
			if err != nil || !reflect.DeepEqual(ids, test.want) {
				t.Fatalf("filtered = %v, want %v, err = %v", ids, test.want, err)
			}
		})
	}
	ids, err := store.FilterQuickSourceBlocks(ctx, []string{"existing", "blank"}, empty, true)
	if err != nil {
		t.Fatal(err)
	}
	result, err := store.ToggleQuickSources(ctx, QuickSourceRequest{OperationID: "cancel-empty",
		BlockIDs: ids, CreatedAt: now + 3})
	if err != nil || result.Action != QuickSourceActionRemoved {
		t.Fatalf("cancel empty card: %+v, %v", result, err)
	}
	ids, err = store.FilterQuickSourceBlocks(ctx, []string{"existing", "blank"}, empty, true)
	if err != nil || len(ids) != 0 {
		t.Fatalf("deleted empty card would be restored: %v, %v", ids, err)
	}
	assertReviewStateForTest(t, ctx, store, cardID, now+86400000, 0)
	if _, found, err := store.Projection().CurrentEntity(ctx, EntityCardSource, LegacyQuickSourceID("blank")); err != nil || found {
		t.Fatalf("blank source was written: found=%v, err=%v", found, err)
	}
}
