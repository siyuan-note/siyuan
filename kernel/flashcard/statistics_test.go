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
	"math"
	"testing"
)

func TestStatisticsKeepsDeletedGlobalHistoryAndExcludesUnknownDuration(t *testing.T) {
	ctx := context.Background()
	store := newGenerationTestStore(t, ctx)
	defer store.Close()
	now := int64(1786431600000)
	setupQueryFixtures(t, ctx, store, now)
	knownDuration := int64(1500)
	first := statisticsLegacyReviewEvent(t, "statistics-review-a", "card-query-1", "source-query-1",
		ReviewAgain, now-7200000, nil)
	second := statisticsLegacyReviewEvent(t, "statistics-review-b", "card-query-4", "source-query-2",
		ReviewGood, now-3600000, &knownDuration)
	if _, err := store.Apply(ctx, "statistics-reviews", []Change{{Kind: RecordEvent, Event: &first},
		{Kind: RecordEvent, Event: &second}}); err != nil {
		t.Fatal(err)
	}
	cardRevision, found, err := store.Projection().CurrentEntity(ctx, EntityCard, "card-query-1")
	if err != nil || !found {
		t.Fatalf("flashcard to delete was not found: found=%v err=%v", found, err)
	}
	deleted, err := NewOperationEntityRevision("statistics-delete", EntityCard, "card-query-1",
		[]string{cardRevision.RevisionID}, now-1000, true, map[string]any{})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = store.Apply(ctx, "statistics-delete", []Change{{Kind: RecordEntityRevision, Revision: &deleted}}); err != nil {
		t.Fatal(err)
	}
	result, err := store.Projection().Statistics(ctx, StatisticsRequest{
		From: now - 86400000, To: now + 1, Now: now, Bucket: StatisticsBucketDay,
		TimezoneOffsetMinutes: 8 * 60, FutureDays: 3,
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.Scope != "global" || result.Overview.CurrentCards != 4 || result.Overview.DeletedCards != 1 ||
		result.History.Reviews != 2 || result.History.UniqueCards != 2 || result.History.Correct != 1 ||
		result.History.Lapses != 1 || result.History.DurationKnown != 1 || result.History.DurationUnknown != 1 ||
		result.History.DurationTotalMS != knownDuration || result.History.AverageDurationMS == nil ||
		*result.History.AverageDurationMS != float64(knownDuration) || result.History.Ratings[string(ReviewAgain)] != 1 ||
		result.History.Ratings[string(ReviewGood)] != 1 || math.Abs(result.History.TrueRetention-0.5) > 0.000001 {
		t.Fatalf("unexpected global statistics: %+v", result)
	}
	if len(result.Series) != 1 || result.Series[0].Reviews != 2 || result.Series[0].UniqueCards != 2 ||
		len(result.FutureDue) != 3 {
		t.Fatalf("unexpected statistics series or forecast: series=%+v future=%+v", result.Series, result.FutureDue)
	}
	if encoded, marshalErr := json.Marshal(result); marshalErr != nil || !json.Valid(encoded) {
		t.Fatalf("statistics result is not valid JSON: %s err=%v", encoded, marshalErr)
	}
}

func TestStatisticsCurrentCardScopeDoesNotResurrectDeletedHistory(t *testing.T) {
	ctx := context.Background()
	store := newGenerationTestStore(t, ctx)
	defer store.Close()
	now := int64(1786431600000)
	setupQueryFixtures(t, ctx, store, now)
	duration := int64(900)
	first := statisticsLegacyReviewEvent(t, "statistics-scope-a", "card-query-1", "source-query-1",
		ReviewAgain, now-2000, &duration)
	second := statisticsLegacyReviewEvent(t, "statistics-scope-b", "card-query-4", "source-query-2",
		ReviewEasy, now-1000, &duration)
	if _, err := store.Apply(ctx, "statistics-scope-reviews", []Change{{Kind: RecordEvent, Event: &first},
		{Kind: RecordEvent, Event: &second}}); err != nil {
		t.Fatal(err)
	}
	cardRevision, found, err := store.Projection().CurrentEntity(ctx, EntityCard, "card-query-1")
	if err != nil || !found {
		t.Fatal(err)
	}
	deleted, err := NewOperationEntityRevision("statistics-scope-delete", EntityCard, "card-query-1",
		[]string{cardRevision.RevisionID}, now, true, map[string]any{})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = store.Apply(ctx, "statistics-scope-delete",
		[]Change{{Kind: RecordEntityRevision, Revision: &deleted}}); err != nil {
		t.Fatal(err)
	}
	result, err := store.Projection().Statistics(ctx, StatisticsRequest{
		CardIDs: []string{"card-query-1", "card-query-4"}, From: now - 10000, To: now + 1, Now: now,
		Bucket: StatisticsBucketDay, FutureDays: 1,
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.Scope != "cards" || result.Overview.CurrentCards != 1 || result.Overview.DeletedCards != 0 ||
		result.History.Reviews != 1 || result.History.UniqueCards != 1 || result.History.Lapses != 0 ||
		result.History.Ratings[string(ReviewEasy)] != 1 {
		t.Fatalf("deleted card history entered current-card statistics: %+v", result)
	}
}

func TestStatisticsRejectsAmbiguousScope(t *testing.T) {
	ctx := context.Background()
	store := newGenerationTestStore(t, ctx)
	defer store.Close()
	_, err := store.Projection().Statistics(ctx, StatisticsRequest{
		ReviewSetID: "set", CardIDs: []string{"card"}, Now: 1, Bucket: StatisticsBucketDay,
	})
	if err == nil {
		t.Fatal("statistics accepted multiple scopes")
	}
}

func TestStatisticsIntersectsReviewSetAndQuery(t *testing.T) {
	ctx := context.Background()
	store := newGenerationTestStore(t, ctx)
	defer store.Close()
	now := int64(1786431600000)
	setupQueryFixtures(t, ctx, store, now)
	query := predicateQuery("flag", QueryEqual, json.RawMessage(`4`))
	result, err := store.Projection().Statistics(ctx, StatisticsRequest{
		ReviewSetID: "review-set-query", Query: &query, From: now - 86400000, To: now + 1, Now: now,
		Bucket: StatisticsBucketDay, FutureDays: 1,
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.Scope != "reviewSet" || result.Overview.CurrentCards != 1 {
		t.Fatalf("review set query statistics did not intersect scopes: %+v", result)
	}
}

func TestStatisticsExcludesCardsWithUnresolvedSourceConflict(t *testing.T) {
	ctx := context.Background()
	store := newGenerationTestStore(t, ctx)
	defer store.Close()
	now := int64(1786431600000)
	setupQueryFixtures(t, ctx, store, now)
	base, found, err := store.Projection().CurrentEntity(ctx, EntityCardSource, "source-query-2")
	if err != nil || !found {
		t.Fatalf("base source was not found: found=%v err=%v", found, err)
	}
	for index, operationID := range []string{"statistics-source-branch-a", "statistics-source-branch-b"} {
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
		if _, err = store.Apply(ctx, operationID,
			[]Change{{Kind: RecordEntityRevision, Revision: &revision}}); err != nil {
			t.Fatal(err)
		}
	}
	result, err := store.Projection().Statistics(ctx, StatisticsRequest{
		From: now - 86400000, To: now + 1, Now: now, Bucket: StatisticsBucketDay, FutureDays: 1,
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.Overview.CurrentCards != 2 {
		t.Fatalf("source-conflicted cards entered statistics: %+v", result.Overview)
	}
}

func statisticsLegacyReviewEvent(t *testing.T, operationID, cardID, sourceID string, rating ReviewRating,
	reviewedAt int64, duration *int64) Event {
	t.Helper()
	event, err := NewReviewEvent(operationID, ReviewEventPayload{
		CardID: cardID, SourceID: sourceID, OriginCardID: "legacy-" + cardID, Kind: "review", Rating: rating,
		ReviewedAt: reviewedAt, DurationMS: duration, SchedulerVersion: "legacy-unknown",
		PresetRevisionID: "legacy-preset", SchedulerInput: json.RawMessage(`{}`), ReviewMode: "normal",
	})
	if err != nil {
		t.Fatal(err)
	}
	return event
}
