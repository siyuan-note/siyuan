// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

package flashcard

import (
	"context"
	"encoding/json"
	"sort"
	"testing"
)

func TestCardSearchUsesTypedPredicatesAndAvailabilityFilters(t *testing.T) {
	ctx := context.Background()
	store := newGenerationTestStore(t, ctx)
	defer store.Close()
	now := int64(1786431600000)
	setupQueryFixtures(t, ctx, store, now)

	dueQuery := predicateQuery("due", QueryLessOrEqual, json.RawMessage(`1786431600000`))
	results, err := store.Projection().SearchCards(ctx, &dueQuery, CardSearchOptions{Now: now})
	if err != nil {
		t.Fatal(err)
	}
	assertSearchCardIDs(t, results, []string{"card-query-1"})

	blockQuery := predicateQuery("blockID", QueryEqual, json.RawMessage(`"block-query-1"`))
	results, err = store.Projection().SearchCards(ctx, &blockQuery, CardSearchOptions{Now: now})
	if err != nil {
		t.Fatal(err)
	}
	assertSearchCardIDs(t, results, []string{"card-query-1"})

	notTaggedQuery := predicateQuery("tagID", QueryNotEqual, json.RawMessage(`"tag-child"`))
	results, err = store.Projection().SearchCards(ctx, &notTaggedQuery, CardSearchOptions{Now: now})
	if err != nil {
		t.Fatal(err)
	}
	assertSearchCardIDs(t, results, []string{"card-query-4"})

	stabilityQuery := predicateQuery("stability", QueryGreater, json.RawMessage(`7`))
	results, err = store.Projection().SearchCards(ctx, &stabilityQuery, CardSearchOptions{
		Now: now, IncludeInactive: true, IncludeSuspended: true, IncludeBuried: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	assertSearchCardIDs(t, results, []string{"card-query-4"})
	difficultyQuery := predicateQuery("difficulty", QueryEqual, json.RawMessage(`7`))
	results, err = store.Projection().SearchCards(ctx, &difficultyQuery, CardSearchOptions{
		Now: now, IncludeInactive: true, IncludeSuspended: true, IncludeBuried: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	assertSearchCardIDs(t, results, []string{"card-query-4"})
	retrievabilityQuery := predicateQuery("retrievability", QueryGreater, json.RawMessage(`0.9`))
	results, err = store.Projection().SearchCards(ctx, &retrievabilityQuery, CardSearchOptions{
		Now: now, IncludeInactive: true, IncludeSuspended: true, IncludeBuried: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	assertSearchCardIDs(t, results, []string{"card-query-4"})

	all := QueryAST{Version: QueryVersion, Root: QueryExpression{Operator: QueryMatchAll}}
	results, err = store.Projection().SearchCards(ctx, &all, CardSearchOptions{
		Now: now, IncludeInactive: true, IncludeSuspended: true, IncludeBuried: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	assertSearchCardIDs(t, results, []string{
		"card-query-1", "card-query-2", "card-query-3", "card-query-4", "card-query-5",
	})
	byID := map[string]CardSearchResult{}
	for _, result := range results {
		byID[result.Card.ID] = result
	}
	if result := byID["card-query-1"]; result.EffectivePriority != "learning" ||
		len(result.CardTagIDs) != 1 || result.CardTagIDs[0] != "tag-child" ||
		len(result.SourceTagIDs) != 0 || len(result.EffectiveTagIDs) != 1 ||
		result.EffectiveTagIDs[0] != "tag-child" {
		t.Fatalf("unexpected card-level effective values: %+v", result)
	}
	if result := byID["card-query-4"]; result.EffectivePriority != "retaining" ||
		len(result.CardTagIDs) != 0 || len(result.SourceTagIDs) != 1 ||
		result.SourceTagIDs[0] != "tag-root" || len(result.EffectiveTagIDs) != 1 ||
		result.EffectiveTagIDs[0] != "tag-root" {
		t.Fatalf("unexpected source-level effective values: %+v", result)
	}
}

func TestCardSearchGroupsBeforePagination(t *testing.T) {
	ctx := context.Background()
	store := newGenerationTestStore(t, ctx)
	defer store.Close()
	now := int64(1786431600000)
	setupQueryFixtures(t, ctx, store, now)
	options := CardSearchOptions{Now: now, IncludeInactive: true, IncludeSuspended: true, IncludeBuried: true,
		IncludePaused: true, GroupBySource: true, Limit: 1}
	first, err := store.Projection().SearchCards(ctx, nil, options)
	if err != nil {
		t.Fatal(err)
	}
	assertSearchCardIDs(t, first, []string{"card-query-1", "card-query-2"})
	options.Offset = 1
	second, err := store.Projection().SearchCards(ctx, nil, options)
	if err != nil {
		t.Fatal(err)
	}
	assertSearchCardIDs(t, second, []string{"card-query-3", "card-query-4", "card-query-5"})
}

func TestReviewSetCombinesDynamicMembersIncludesAndExclusions(t *testing.T) {
	ctx := context.Background()
	store := newGenerationTestStore(t, ctx)
	defer store.Close()
	now := int64(1786431600000)
	setupQueryFixtures(t, ctx, store, now)
	cardIDs, err := store.Projection().ReviewSetCardIDs(ctx, "review-set-query", CardSearchOptions{Now: now})
	if err != nil {
		t.Fatal(err)
	}
	if len(cardIDs) != 1 || cardIDs[0] != "card-query-4" {
		t.Fatalf("unexpected resolved review set cards: %v", cardIDs)
	}
	allCards, err := store.Projection().ReviewSetCardIDs(ctx, "review-set-query", CardSearchOptions{
		Now: now, IncludeInactive: true, IncludeSuspended: true, IncludeBuried: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if !containsString(allCards, "card-query-3") || !containsString(allCards, "card-query-5") ||
		containsString(allCards, "card-query-1") {
		t.Fatalf("review set availability or exclusion semantics are incorrect: %v", allCards)
	}
	page, err := store.Projection().ReviewSetCardPage(ctx, "review-set-query", CardSearchOptions{
		Now: now, IncludeInactive: true, IncludeSuspended: true, IncludeBuried: true, Limit: 1, Offset: 1,
	})
	if err != nil || page.Total != 3 || len(page.CardIDs) != 1 || page.CardIDs[0] != "card-query-4" {
		t.Fatalf("review set pagination changed membership semantics: page=%+v err=%v", page, err)
	}
	filter := predicateQuery("flag", QueryIn, json.RawMessage(`[4,5,6,7]`))
	page, err = store.Projection().ReviewSetCardPageWithQuery(ctx, "review-set-query", &filter, CardSearchOptions{
		Now: now, IncludeInactive: true, IncludeSuspended: true, IncludeBuried: true, Limit: 1, Offset: 1,
	})
	if err != nil || page.Total != 2 || len(page.CardIDs) != 1 || page.CardIDs[0] != "card-query-5" {
		t.Fatalf("review set filter was not applied before pagination: page=%+v err=%v", page, err)
	}
	if _, err = store.SetReviewSetMemberships(ctx, SetReviewSetMembershipsRequest{
		OperationID: "include-query-card-2-for-group-page", ReviewSetID: "review-set-query",
		CardIDs: []string{"card-query-2"}, Mode: MembershipInclude, ChangedAt: now + 1,
	}); err != nil {
		t.Fatal(err)
	}
	page, err = store.Projection().ReviewSetCardPage(ctx, "review-set-query", CardSearchOptions{
		Now: now, IncludeInactive: true, IncludeSuspended: true, IncludeBuried: true, IncludePaused: true,
		GroupBySource: true, Limit: 1,
	})
	if err != nil || page.Total != 2 || len(page.CardIDs) != 1 || page.CardIDs[0] != "card-query-2" {
		t.Fatalf("review set did not paginate complete source groups: page=%+v err=%v", page, err)
	}
	page, err = store.Projection().ReviewSetCardPage(ctx, "review-set-query", CardSearchOptions{
		Now: now, IncludeInactive: true, IncludeSuspended: true, IncludeBuried: true, IncludePaused: true,
		GroupBySource: true, ReturnCards: true, Limit: 1, Offset: 1,
	})
	if err != nil || page.Total != 2 || len(page.CardIDs) != 3 || len(page.Cards) != 3 {
		t.Fatalf("review set split a source group across pages: page=%+v err=%v", page, err)
	}
	for index, cardID := range page.CardIDs {
		if page.Cards[index].Card.ID != cardID {
			t.Fatalf("review set returned cards out of page order: page=%+v", page)
		}
	}
}

func TestReviewSetSummariesCountMembersAndCurrentlyDueCards(t *testing.T) {
	ctx := context.Background()
	store := newGenerationTestStore(t, ctx)
	defer store.Close()
	now := int64(1786431600000)
	setupQueryFixtures(t, ctx, store, now)
	stateRevision, found, err := store.Projection().CurrentEntity(ctx, EntityReviewState, "card-query-4")
	if err != nil || !found {
		t.Fatalf("review state for summary was not found: found=%v err=%v", found, err)
	}
	var state ReviewState
	if err = decodeStrictJSON(stateRevision.Payload, &state); err != nil {
		t.Fatal(err)
	}
	state.Due = now
	operationID := "make-review-set-summary-card-due"
	state.StateRevisionID = OperationRevisionID(operationID, EntityReviewState, state.CardID)
	updatedState, err := NewOperationEntityRevision(operationID, EntityReviewState, state.CardID,
		[]string{stateRevision.RevisionID}, now+1, false, state)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = store.Apply(ctx, operationID,
		[]Change{{Kind: RecordEntityRevision, Revision: &updatedState}}); err != nil {
		t.Fatal(err)
	}
	summaries, err := store.Projection().ReviewSetSummaries(ctx, []string{"review-set-query"}, now)
	if err != nil {
		t.Fatal(err)
	}
	summary := summaries["review-set-query"]
	if summary.ReviewSetID != "review-set-query" || summary.Cards != 2 || summary.Due != 1 ||
		summary.Included != 1 || summary.Excluded != 1 {
		t.Fatalf("unexpected review set summary: %+v", summary)
	}
	if _, err = store.Projection().ReviewSetSummaries(ctx,
		[]string{"review-set-query", "review-set-query"}, now); err == nil {
		t.Fatal("expected duplicate review set summary request to fail")
	}
}

func TestSetReviewSetMembershipsReusesExistingPairAndIsIdempotent(t *testing.T) {
	ctx := context.Background()
	store := newGenerationTestStore(t, ctx)
	defer store.Close()
	now := int64(1786431600000)
	setupQueryFixtures(t, ctx, store, now)
	request := SetReviewSetMembershipsRequest{OperationID: "exclude-query-card-4",
		ReviewSetID: "review-set-query", CardIDs: []string{"card-query-4"}, Mode: MembershipExclude,
		ChangedAt: now + 1}
	result, err := store.SetReviewSetMemberships(ctx, request)
	if err != nil {
		t.Fatal(err)
	}
	retried, err := store.SetReviewSetMemberships(ctx, request)
	if err != nil || retried.Batch.BatchID != result.Batch.BatchID {
		t.Fatalf("membership retry changed its operation: result=%+v err=%v", retried, err)
	}
	cardIDs, err := store.Projection().ReviewSetCardIDs(ctx, request.ReviewSetID, CardSearchOptions{Now: now})
	if err != nil || len(cardIDs) != 0 {
		t.Fatalf("manual exclusion did not override the review set: cards=%v err=%v", cardIDs, err)
	}

	request = SetReviewSetMembershipsRequest{OperationID: "include-query-card-1",
		ReviewSetID: "review-set-query", CardIDs: []string{"card-query-1"}, Mode: MembershipInclude,
		ChangedAt: now + 2}
	if _, err = store.SetReviewSetMemberships(ctx, request); err != nil {
		t.Fatal(err)
	}
	cardIDs, err = store.Projection().ReviewSetCardIDs(ctx, request.ReviewSetID, CardSearchOptions{Now: now})
	if err != nil || len(cardIDs) != 1 || cardIDs[0] != "card-query-1" {
		t.Fatalf("existing exclusion was not replaced by inclusion: cards=%v err=%v", cardIDs, err)
	}
}

func TestSetReviewSetMembershipsCanRestoreAutomaticQueryMembership(t *testing.T) {
	ctx := context.Background()
	store := newGenerationTestStore(t, ctx)
	defer store.Close()
	now := int64(1786431600000)
	setupQueryFixtures(t, ctx, store, now)
	clearRequest := SetReviewSetMembershipsRequest{OperationID: "clear-query-card-1",
		ReviewSetID: "review-set-query", CardIDs: []string{"card-query-1"}, Mode: MembershipAutomatic,
		ChangedAt: now + 1}
	cleared, err := store.SetReviewSetMemberships(ctx, clearRequest)
	if err != nil || len(cleared.ClearedCardIDs) != 1 || cleared.ClearedCardIDs[0] != "card-query-1" {
		t.Fatalf("manual membership was not cleared: result=%+v err=%v", cleared, err)
	}
	retried, err := store.SetReviewSetMemberships(ctx, clearRequest)
	if err != nil || retried.Batch.BatchID != cleared.Batch.BatchID {
		t.Fatalf("membership clear retry changed its operation: result=%+v err=%v", retried, err)
	}
	cardIDs, err := store.Projection().ReviewSetCardIDs(ctx, clearRequest.ReviewSetID,
		CardSearchOptions{Now: now})
	if err != nil || !containsString(cardIDs, "card-query-1") {
		t.Fatalf("cleared exclusion did not restore dynamic membership: cards=%v err=%v", cardIDs, err)
	}
	clearFresh := SetReviewSetMembershipsRequest{OperationID: "clear-query-card-2",
		ReviewSetID: "review-set-query", CardIDs: []string{"card-query-2"}, Mode: MembershipAutomatic,
		ChangedAt: now + 2}
	if _, err = store.SetReviewSetMemberships(ctx, clearFresh); err != nil {
		t.Fatal(err)
	}
	includeAfterClear := SetReviewSetMembershipsRequest{OperationID: "include-cleared-query-card-2",
		ReviewSetID: "review-set-query", CardIDs: []string{"card-query-2"}, Mode: MembershipInclude,
		ChangedAt: now + 3}
	if _, err = store.SetReviewSetMemberships(ctx, includeAfterClear); err != nil {
		t.Fatalf("fresh membership tombstone could not be superseded: %v", err)
	}
	cardIDs, err = store.Projection().ReviewSetCardIDs(ctx, clearRequest.ReviewSetID,
		CardSearchOptions{Now: now, IncludeSuspended: true})
	if err != nil || !containsString(cardIDs, "card-query-2") {
		t.Fatalf("included membership after clear was not projected: cards=%v err=%v", cardIDs, err)
	}
}

func TestCardSearchUsesLocationQueriesAndHierarchicalStudyPolicies(t *testing.T) {
	ctx := context.Background()
	store := newGenerationTestStore(t, ctx)
	defer store.Close()
	now := int64(1786431600000)
	setupQueryFixtures(t, ctx, store, now)

	sourceRevision, found, err := store.Projection().CurrentEntity(ctx, EntityCardSource, "source-query-2")
	if err != nil || !found {
		t.Fatalf("query source was not found: found=%v err=%v", found, err)
	}
	var source CardSource
	if err = decodeStrictJSON(sourceRevision.Payload, &source); err != nil {
		t.Fatal(err)
	}
	source.Priority = ""
	operationID := "setup-query-study-policies"
	updatedSource, err := NewOperationEntityRevision(operationID, EntityCardSource, source.ID,
		[]string{sourceRevision.RevisionID}, now+1, false, source)
	if err != nil {
		t.Fatal(err)
	}
	policies := []StudyPolicy{
		{ID: "policy-notebook", ScopeType: "notebook", ScopeID: "notebook-query", Priority: "paused",
			CreatedAt: now, UpdatedAt: now},
		{ID: "policy-parent", ScopeType: "document", ScopeID: "doc-parent", Priority: "exam",
			CreatedAt: now, UpdatedAt: now},
		{ID: "policy-child", ScopeType: "document", ScopeID: "doc-child", Priority: "learning",
			CreatedAt: now, UpdatedAt: now},
	}
	changes := []Change{{Kind: RecordEntityRevision, Revision: &updatedSource}}
	for _, policy := range policies {
		revision, revisionErr := NewOperationEntityRevision(operationID, EntityStudyPolicy, policy.ID, nil,
			now+1, false, policy)
		if revisionErr != nil {
			t.Fatal(revisionErr)
		}
		changes = append(changes, Change{Kind: RecordEntityRevision, Revision: &revision})
	}
	if _, err = store.Apply(ctx, operationID, changes); err != nil {
		t.Fatal(err)
	}
	if err = store.Projection().ReplaceBlockMetadata(ctx, []BlockMetadata{
		{BlockID: "block-query-1", NotebookID: "notebook-other", RootID: "doc-other", Path: "/doc-other.sy",
			Content: "Unrelated source"},
		{BlockID: "block-query-2", NotebookID: "notebook-query", RootID: "doc-child",
			Path: "/doc-parent/doc-child.sy", Content: "Alpha searchable content"},
	}); err != nil {
		t.Fatal(err)
	}

	cardQuery := predicateQuery("cardID", QueryEqual, json.RawMessage(`"card-query-4"`))
	results, err := store.Projection().SearchCards(ctx, &cardQuery, CardSearchOptions{Now: now})
	if err != nil || len(results) != 1 || results[0].EffectivePriority != "learning" {
		t.Fatalf("nearest document policy was not applied: results=%+v err=%v", results, err)
	}
	for _, query := range []QueryAST{
		predicateQuery("notebookID", QueryEqual, json.RawMessage(`"notebook-query"`)),
		predicateQuery("rootID", QueryEqual, json.RawMessage(`"doc-child"`)),
		predicateQuery("path", QueryStartsWith, json.RawMessage(`"/doc-parent"`)),
	} {
		results, err = store.Projection().SearchCards(ctx, &query, CardSearchOptions{Now: now,
			IncludeSuspended: true, IncludeBuried: true})
		if err != nil {
			t.Fatal(err)
		}
		assertSearchCardIDs(t, results, []string{"card-query-3", "card-query-4"})
	}
	contentQuery := predicateQuery("content", QueryContains, json.RawMessage(`"searchable"`))
	results, err = store.Projection().SearchCards(ctx, &contentQuery, CardSearchOptions{Now: now,
		IncludeSuspended: true, IncludeBuried: true})
	if err != nil {
		t.Fatal(err)
	}
	assertSearchCardIDs(t, results, []string{"card-query-3", "card-query-4"})

	for index, policy := range []StudyPolicy{policies[2], policies[1]} {
		current, currentFound, currentErr := store.Projection().CurrentEntity(ctx, EntityStudyPolicy, policy.ID)
		if currentErr != nil || !currentFound {
			t.Fatalf("study policy was not found: found=%v err=%v", currentFound, currentErr)
		}
		deleteOperationID := "delete-query-study-policy-" + policy.ID
		deleted, revisionErr := NewOperationEntityRevision(deleteOperationID, EntityStudyPolicy, policy.ID,
			[]string{current.RevisionID}, now+int64(index)+2, true, struct{}{})
		if revisionErr != nil {
			t.Fatal(revisionErr)
		}
		if _, err = store.Apply(ctx, deleteOperationID,
			[]Change{{Kind: RecordEntityRevision, Revision: &deleted}}); err != nil {
			t.Fatal(err)
		}
		results, err = store.Projection().SearchCards(ctx, &cardQuery, CardSearchOptions{Now: now})
		if index == 0 {
			if err != nil || len(results) != 1 || results[0].EffectivePriority != "exam" {
				t.Fatalf("parent document policy was not inherited: results=%+v err=%v", results, err)
			}
		} else if err != nil || len(results) != 0 {
			t.Fatalf("notebook pause policy did not exclude the card: results=%+v err=%v", results, err)
		}
	}
	results, err = store.Projection().SearchCards(ctx, &cardQuery,
		CardSearchOptions{Now: now, IncludePaused: true})
	if err != nil || len(results) != 1 || results[0].EffectivePriority != "paused" {
		t.Fatalf("notebook pause policy was not exposed to management: results=%+v err=%v", results, err)
	}
}

func TestCardSearchDerivesOrphanedStatusFromDisposableAvailability(t *testing.T) {
	ctx := context.Background()
	store := newGenerationTestStore(t, ctx)
	defer store.Close()
	now := int64(1786431600000)
	setupQueryFixtures(t, ctx, store, now)
	if err := store.Projection().ReplaceSourceAvailability(ctx,
		map[string]bool{"source-query-1": true, "source-query-2": false}); err != nil {
		t.Fatal(err)
	}
	cardQuery := predicateQuery("cardID", QueryEqual, json.RawMessage(`"card-query-4"`))
	results, err := store.Projection().SearchCards(ctx, &cardQuery, CardSearchOptions{Now: now})
	if err != nil || len(results) != 0 {
		t.Fatalf("unavailable source entered the normal query: results=%+v err=%v", results, err)
	}
	results, err = store.Projection().SearchCards(ctx, &cardQuery,
		CardSearchOptions{Now: now, IncludeInactive: true})
	if err != nil || len(results) != 1 || results[0].Card.GenerationStatus != GenerationOrphaned ||
		results[0].SourceAvailable {
		t.Fatalf("management query did not derive orphaned status: results=%+v err=%v", results, err)
	}
	orphanQuery := predicateQuery("generationStatus", QueryEqual, json.RawMessage(`"orphaned"`))
	results, err = store.Projection().SearchCards(ctx, &orphanQuery,
		CardSearchOptions{Now: now, IncludeInactive: true, IncludeBuried: true})
	if err != nil {
		t.Fatal(err)
	}
	assertSearchCardIDs(t, results, []string{"card-query-3", "card-query-4"})
}

func TestUnresolvedReviewStateConflictIsExcludedFromSearch(t *testing.T) {
	ctx := context.Background()
	store := newGenerationTestStore(t, ctx)
	defer store.Close()
	now := int64(1786431600000)
	setupQueryFixtures(t, ctx, store, now)
	base, found, err := store.Projection().CurrentEntity(ctx, EntityReviewState, "card-query-4")
	if err != nil || !found {
		t.Fatalf("base state was not found: found=%v err=%v", found, err)
	}
	for index, operationID := range []string{"manual-state-branch-a", "manual-state-branch-b"} {
		var state ReviewState
		if err = decodeStrictJSON(base.Payload, &state); err != nil {
			t.Fatal(err)
		}
		state.Due += int64(index + 1)
		state.StateRevisionID = OperationRevisionID(operationID, EntityReviewState, state.CardID)
		revision, revisionErr := NewOperationEntityRevision(operationID, EntityReviewState, state.CardID,
			[]string{base.RevisionID}, now+int64(index+1), false, state)
		if revisionErr != nil {
			t.Fatal(revisionErr)
		}
		if _, err = store.Apply(ctx, operationID, []Change{{Kind: RecordEntityRevision, Revision: &revision}}); err != nil {
			t.Fatal(err)
		}
	}
	cardQuery := predicateQuery("cardID", QueryEqual, json.RawMessage(`"card-query-4"`))
	results, err := store.Projection().SearchCards(ctx, &cardQuery, CardSearchOptions{Now: now})
	if err != nil {
		t.Fatal(err)
	}
	if len(results) != 0 {
		t.Fatal("card with an unresolved review state conflict entered the normal search")
	}
	results, err = store.Projection().SearchCards(ctx, &cardQuery,
		CardSearchOptions{Now: now, IncludeConflicts: true})
	if err != nil || len(results) != 1 {
		t.Fatalf("management search could not include conflicted card: count=%d err=%v", len(results), err)
	}
}

func TestUnresolvedSourceConflictIsExcludedFromSearch(t *testing.T) {
	ctx := context.Background()
	store := newGenerationTestStore(t, ctx)
	defer store.Close()
	now := int64(1786431600000)
	setupQueryFixtures(t, ctx, store, now)
	base, found, err := store.Projection().CurrentEntity(ctx, EntityCardSource, "source-query-2")
	if err != nil || !found {
		t.Fatalf("base source was not found: found=%v err=%v", found, err)
	}
	for index, operationID := range []string{"manual-source-branch-a", "manual-source-branch-b"} {
		var source CardSource
		if err = decodeStrictJSON(base.Payload, &source); err != nil {
			t.Fatal(err)
		}
		source.Priority = []string{"exam", "learning"}[index]
		revision, revisionErr := NewOperationEntityRevision(operationID, EntityCardSource, source.ID,
			[]string{base.RevisionID}, now+int64(index+1), false, source)
		if revisionErr != nil {
			t.Fatal(revisionErr)
		}
		if _, err = store.Apply(ctx, operationID, []Change{{Kind: RecordEntityRevision, Revision: &revision}}); err != nil {
			t.Fatal(err)
		}
	}
	cardQuery := predicateQuery("cardID", QueryEqual, json.RawMessage(`"card-query-4"`))
	results, err := store.Projection().SearchCards(ctx, &cardQuery, CardSearchOptions{Now: now})
	if err != nil || len(results) != 0 {
		t.Fatalf("card with an unresolved source conflict entered normal search: count=%d err=%v", len(results), err)
	}
	results, err = store.Projection().SearchCards(ctx, &cardQuery,
		CardSearchOptions{Now: now, IncludeConflicts: true})
	if err != nil || len(results) != 1 {
		t.Fatalf("management search could not include source-conflicted card: count=%d err=%v", len(results), err)
	}
	_, err = store.ManageCards(ctx, CardManagementRequest{OperationID: "manage-source-conflict",
		CardIDs: []string{"card-query-4"}, Action: CardActionSuspend, ChangedAt: now + 10})
	if err == nil {
		t.Fatal("management changed a card with an unresolved source conflict")
	}
}

func TestUnresolvedAssignedTagAncestorConflictIsExcludedFromSearchAndReview(t *testing.T) {
	ctx := context.Background()
	store := newGenerationTestStore(t, ctx)
	defer store.Close()
	now := int64(1786431600000)
	setupQueryFixtures(t, ctx, store, now)
	base, found, err := store.Projection().CurrentEntity(ctx, EntityTag, "tag-root")
	if err != nil || !found {
		t.Fatalf("base tag was not found: found=%v err=%v", found, err)
	}
	for index, operationID := range []string{"manual-tag-ancestor-branch-a", "manual-tag-ancestor-branch-b"} {
		var tag Tag
		if err = decodeStrictJSON(base.Payload, &tag); err != nil {
			t.Fatal(err)
		}
		tag.Name = []string{"Root A", "Root B"}[index]
		tag.NormalizedName = NormalizeTagName(tag.Name)
		revision, revisionErr := NewOperationEntityRevision(operationID, EntityTag, tag.ID,
			[]string{base.RevisionID}, now+int64(index+1), false, tag)
		if revisionErr != nil {
			t.Fatal(revisionErr)
		}
		if _, err = store.Apply(ctx, operationID, []Change{{Kind: RecordEntityRevision, Revision: &revision}}); err != nil {
			t.Fatal(err)
		}
	}
	cardQuery := predicateQuery("cardID", QueryEqual, json.RawMessage(`"card-query-1"`))
	results, err := store.Projection().SearchCards(ctx, &cardQuery, CardSearchOptions{Now: now})
	if err != nil || len(results) != 0 {
		t.Fatalf("card with an unresolved assigned tag ancestor conflict entered normal search: results=%+v err=%v",
			results, err)
	}
	results, err = store.Projection().SearchCards(ctx, &cardQuery,
		CardSearchOptions{Now: now, IncludeConflicts: true})
	if err != nil || len(results) != 1 {
		t.Fatalf("management could not inspect the tag-conflicted card: results=%+v err=%v", results, err)
	}
	conflicted, err := store.Projection().CardHasUnresolvedConflict(ctx, "card-query-1")
	if err != nil || !conflicted {
		t.Fatalf("assigned tag ancestor conflict did not block card mutations: conflicted=%v err=%v", conflicted, err)
	}
}

func TestUnresolvedSourceReferenceConflictIsExcludedFromSearchAndReview(t *testing.T) {
	ctx := context.Background()
	store := newGenerationTestStore(t, ctx)
	defer store.Close()
	now := int64(1786431600000)
	setupQueryFixtures(t, ctx, store, now)
	base, found, err := store.Projection().CurrentEntity(ctx, EntityCardSourceRef, "ref-query-2")
	if err != nil || !found {
		t.Fatalf("base source reference was not found: found=%v err=%v", found, err)
	}
	for index, operationID := range []string{"manual-ref-branch-a", "manual-ref-branch-b"} {
		var reference CardSourceRef
		if err = decodeStrictJSON(base.Payload, &reference); err != nil {
			t.Fatal(err)
		}
		reference.Role = []string{"content-a", "content-b"}[index]
		revision, revisionErr := NewOperationEntityRevision(operationID, EntityCardSourceRef, reference.ID,
			[]string{base.RevisionID}, now+int64(index+1), false, reference)
		if revisionErr != nil {
			t.Fatal(revisionErr)
		}
		if _, err = store.Apply(ctx, operationID, []Change{{Kind: RecordEntityRevision, Revision: &revision}}); err != nil {
			t.Fatal(err)
		}
	}
	cardQuery := predicateQuery("cardID", QueryEqual, json.RawMessage(`"card-query-4"`))
	results, err := store.Projection().SearchCards(ctx, &cardQuery, CardSearchOptions{Now: now})
	if err != nil || len(results) != 0 {
		t.Fatalf("card with an unresolved source reference conflict entered normal search: count=%d err=%v",
			len(results), err)
	}
	conflicted, err := store.Projection().CardHasUnresolvedConflict(ctx, "card-query-4")
	if err != nil || !conflicted {
		t.Fatalf("source reference conflict did not block card review: conflicted=%v err=%v", conflicted, err)
	}
}

func TestUnresolvedAncestorStudyPolicyConflictIsExcludedFromSearch(t *testing.T) {
	ctx := context.Background()
	store := newGenerationTestStore(t, ctx)
	defer store.Close()
	now := int64(1786431600000)
	setupQueryFixtures(t, ctx, store, now)
	sourceRevision, found, err := store.Projection().CurrentEntity(ctx, EntityCardSource, "source-query-2")
	if err != nil || !found {
		t.Fatalf("query source was not found: found=%v err=%v", found, err)
	}
	var source CardSource
	if err = decodeStrictJSON(sourceRevision.Payload, &source); err != nil {
		t.Fatal(err)
	}
	source.Priority = ""
	setupOperationID := "setup-ancestor-policy-conflict"
	updatedSource, err := NewOperationEntityRevision(setupOperationID, EntityCardSource, source.ID,
		[]string{sourceRevision.RevisionID}, now+1, false, source)
	if err != nil {
		t.Fatal(err)
	}
	policy := StudyPolicy{ID: "policy-ancestor-conflict", ScopeType: "document", ScopeID: "doc-parent",
		Priority: "learning", CreatedAt: now, UpdatedAt: now}
	basePolicy, err := NewOperationEntityRevision(setupOperationID, EntityStudyPolicy, policy.ID, nil,
		now+1, false, policy)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = store.Apply(ctx, setupOperationID, []Change{
		{Kind: RecordEntityRevision, Revision: &updatedSource},
		{Kind: RecordEntityRevision, Revision: &basePolicy},
	}); err != nil {
		t.Fatal(err)
	}
	if err = store.Projection().ReplaceBlockMetadata(ctx, []BlockMetadata{{
		BlockID: "block-query-2", NotebookID: "notebook-query", RootID: "doc-child",
		Path: "/doc-parent/doc-child.sy",
	}}); err != nil {
		t.Fatal(err)
	}
	for index, operationID := range []string{"ancestor-policy-branch-a", "ancestor-policy-branch-b"} {
		branch := policy
		branch.Priority = []string{"exam", "retaining"}[index]
		branch.UpdatedAt = now + int64(index) + 2
		revision, revisionErr := NewOperationEntityRevision(operationID, EntityStudyPolicy, branch.ID,
			[]string{basePolicy.RevisionID}, branch.UpdatedAt, false, branch)
		if revisionErr != nil {
			t.Fatal(revisionErr)
		}
		if _, err = store.Apply(ctx, operationID,
			[]Change{{Kind: RecordEntityRevision, Revision: &revision}}); err != nil {
			t.Fatal(err)
		}
	}
	cardQuery := predicateQuery("cardID", QueryEqual, json.RawMessage(`"card-query-4"`))
	results, err := store.Projection().SearchCards(ctx, &cardQuery, CardSearchOptions{Now: now})
	if err != nil || len(results) != 0 {
		t.Fatalf("card with an unresolved ancestor policy conflict entered normal search: results=%+v err=%v",
			results, err)
	}
	results, err = store.Projection().SearchCards(ctx, &cardQuery,
		CardSearchOptions{Now: now, IncludeConflicts: true})
	if err != nil || len(results) != 1 {
		t.Fatalf("management could not inspect the ancestor-policy-conflicted card: results=%+v err=%v",
			results, err)
	}
	conflicted, err := store.Projection().CardHasUnresolvedConflict(ctx, "card-query-4")
	if err != nil || !conflicted {
		t.Fatalf("ancestor policy conflict did not block card mutations: conflicted=%v err=%v", conflicted, err)
	}
}

func TestUnresolvedReviewSetMembershipConflictIsExcluded(t *testing.T) {
	ctx := context.Background()
	store := newGenerationTestStore(t, ctx)
	defer store.Close()
	now := int64(1786431600000)
	setupQueryFixtures(t, ctx, store, now)
	base, found, err := store.Projection().CurrentEntity(ctx, EntityReviewSetMembership,
		"membership-include-4")
	if err != nil || !found {
		t.Fatalf("base review set membership was not found: found=%v err=%v", found, err)
	}
	for index, operationID := range []string{"manual-membership-exclude", "manual-membership-include"} {
		var membership ReviewSetMembership
		if err = decodeStrictJSON(base.Payload, &membership); err != nil {
			t.Fatal(err)
		}
		membership.Mode = []MembershipMode{MembershipExclude, MembershipInclude}[index]
		revision, revisionErr := NewOperationEntityRevision(operationID, EntityReviewSetMembership,
			membership.ID, []string{base.RevisionID}, now+int64(index+1), false, membership)
		if revisionErr != nil {
			t.Fatal(revisionErr)
		}
		if _, err = store.Apply(ctx, operationID, []Change{{Kind: RecordEntityRevision, Revision: &revision}}); err != nil {
			t.Fatal(err)
		}
	}
	options := CardSearchOptions{Now: now, IncludeInactive: true, IncludeSuspended: true, IncludeBuried: true}
	cardIDs, err := store.Projection().ReviewSetCardIDs(ctx, "review-set-query", options)
	if err != nil || containsString(cardIDs, "card-query-4") {
		t.Fatalf("conflicted membership entered the normal review set: cards=%v err=%v", cardIDs, err)
	}
	options.IncludeConflicts = true
	cardIDs, err = store.Projection().ReviewSetCardIDs(ctx, "review-set-query", options)
	if err != nil || !containsString(cardIDs, "card-query-4") {
		t.Fatalf("management could not inspect the selected membership branch: cards=%v err=%v", cardIDs, err)
	}
}

func setupQueryFixtures(t *testing.T, ctx context.Context, store *Store, now int64) {
	t.Helper()
	operationID := "setup-query-fixtures"
	query := predicateQuery("tagID", QueryDescendantOf, json.RawMessage(`"tag-root"`))
	queryJSON := mustRawJSON(t, query)
	entities := []struct {
		entityType EntityType
		entityID   string
		payload    any
	}{
		{EntityCardSchema, "schema-query", testGenerationSchema("schema-query", []string{
			"template-1", "template-2", "template-3", "template-4", "template-5",
		})},
		{EntityCardTemplate, "template-1", testGenerationTemplate("template-1", "schema-query",
			GenerationStatic, "a", true)},
		{EntityCardTemplate, "template-2", testGenerationTemplate("template-2", "schema-query",
			GenerationStatic, "b", true)},
		{EntityCardTemplate, "template-3", testGenerationTemplate("template-3", "schema-query",
			GenerationStatic, "c", true)},
		{EntityCardTemplate, "template-4", testGenerationTemplate("template-4", "schema-query",
			GenerationStatic, "d", true)},
		{EntityCardTemplate, "template-5", testGenerationTemplate("template-5", "schema-query",
			GenerationStatic, "e", true)},
		{EntityCardSource, "source-query-1", CardSource{ID: "source-query-1", SchemaID: "schema-query",
			SourceType: "block", PrimaryRefID: "ref-query-1", Priority: "learning",
			GenerationConfig: json.RawMessage(`{}`), Status: "active"}},
		{EntityCardSource, "source-query-2", CardSource{ID: "source-query-2", SchemaID: "schema-query",
			SourceType: "block", PrimaryRefID: "ref-query-2", Priority: "retaining",
			GenerationConfig: json.RawMessage(`{}`), Status: "active"}},
		{EntityCardSourceRef, "ref-query-1", CardSourceRef{ID: "ref-query-1", SourceID: "source-query-1",
			FieldID: "field-query", EntityType: "block", EntityID: "block-query-1", Role: "content", Required: true}},
		{EntityCardSourceRef, "ref-query-2", CardSourceRef{ID: "ref-query-2", SourceID: "source-query-2",
			FieldID: "field-query", EntityType: "block", EntityID: "block-query-2", Role: "content", Required: true}},
		{EntityCard, "card-query-1", queryFixtureCard("card-query-1", "source-query-1", "template-1", "a",
			GenerationActive, 1, now)},
		{EntityCard, "card-query-2", queryFixtureCard("card-query-2", "source-query-1", "template-2", "b",
			GenerationActive, 2, now)},
		{EntityCard, "card-query-3", queryFixtureCard("card-query-3", "source-query-2", "template-3", "c",
			GenerationActive, 3, now)},
		{EntityCard, "card-query-4", queryFixtureCard("card-query-4", "source-query-2", "template-4", "d",
			GenerationActive, 4, now)},
		{EntityCard, "card-query-5", queryFixtureCard("card-query-5", "source-query-2", "template-5", "e",
			GenerationDisabledByTemplate, 5, now)},
		{EntityTag, "tag-root", Tag{ID: "tag-root", Name: "Root", NormalizedName: "root"}},
		{EntityTag, "tag-child", Tag{ID: "tag-child", ParentID: "tag-root", Name: "Child", NormalizedName: "child"}},
		{EntityTagAssignment, "tag-assignment-card-1", TagAssignment{ID: "tag-assignment-card-1",
			TagID: "tag-child", TargetType: "card", TargetID: "card-query-1"}},
		{EntityTagAssignment, "tag-assignment-source-2", TagAssignment{ID: "tag-assignment-source-2",
			TagID: "tag-root", TargetType: "source", TargetID: "source-query-2"}},
		{EntityReviewSet, "review-set-query", ReviewSet{ID: "review-set-query", Name: "Query Set",
			QueryAST: queryJSON, NewLimit: 20, ReviewLimit: 200, DefaultReviewMode: "normal"}},
		{EntityReviewSetMembership, "membership-exclude-1", ReviewSetMembership{ID: "membership-exclude-1",
			ReviewSetID: "review-set-query", CardID: "card-query-1", Mode: MembershipExclude}},
		{EntityReviewSetMembership, "membership-include-4", ReviewSetMembership{ID: "membership-include-4",
			ReviewSetID: "review-set-query", CardID: "card-query-4", Mode: MembershipInclude}},
	}
	states := []ReviewState{
		queryFixtureState("card-query-1", operationID, "new", now, false, 0),
		queryFixtureState("card-query-2", operationID, "review", now-1, true, 0),
		queryFixtureState("card-query-3", operationID, "review", now-1, false, now+10000),
		queryFixtureState("card-query-4", operationID, "review", now+10000, false, 0),
		queryFixtureState("card-query-5", operationID, "new", now, false, 0),
	}
	states[3].Stability = 8
	states[3].Difficulty = 7
	states[3].LastReview = now - 86400000
	for _, state := range states {
		entities = append(entities, struct {
			entityType EntityType
			entityID   string
			payload    any
		}{EntityReviewState, state.CardID, state})
	}
	var changes []Change
	for _, entity := range entities {
		revision, err := NewOperationEntityRevision(operationID, entity.entityType, entity.entityID, nil, now, false,
			entity.payload)
		if err != nil {
			t.Fatal(err)
		}
		changes = append(changes, Change{Kind: RecordEntityRevision, Revision: &revision})
	}
	if _, err := store.Apply(ctx, operationID, changes); err != nil {
		t.Fatal(err)
	}
}

func queryFixtureCard(id, sourceID, templateID, variantKey string, status GenerationStatus, flag int,
	now int64) Card {
	return Card{ID: id, SourceID: sourceID, TemplateID: templateID, VariantKey: variantKey,
		GenerationStatus: status, Flag: flag, CreatedAt: now, UpdatedAt: now}
}

func queryFixtureState(cardID, operationID, state string, due int64, suspended bool, buriedUntil int64) ReviewState {
	return ReviewState{CardID: cardID, ReviewStateSnapshot: ReviewStateSnapshot{
		State: state, Due: due, Stability: 3, Difficulty: 5, Reps: 1, Suspended: suspended,
		BuriedUntil: buriedUntil, StateRevisionID: OperationRevisionID(operationID, EntityReviewState, cardID),
	}}
}

func predicateQuery(field string, comparator QueryComparator, value json.RawMessage) QueryAST {
	return QueryAST{Version: QueryVersion, Root: QueryExpression{
		Operator: QueryPredicate, Field: field, Comparator: comparator, Value: value,
	}}
}

func assertSearchCardIDs(t *testing.T, results []CardSearchResult, expected []string) {
	t.Helper()
	actual := make([]string, 0, len(results))
	for _, result := range results {
		actual = append(actual, result.Card.ID)
	}
	sort.Strings(actual)
	sort.Strings(expected)
	if string(mustCanonicalJSON(t, actual)) != string(mustCanonicalJSON(t, expected)) {
		t.Fatalf("unexpected flashcard search results: got=%v expected=%v", actual, expected)
	}
}
