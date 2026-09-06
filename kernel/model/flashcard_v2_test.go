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

package model

import (
	"testing"

	flashcardv2 "github.com/siyuan-note/siyuan/kernel/flashcard"
)

func TestValidateFlashcardV2MutationsRejectsDedicatedEntityDeletion(t *testing.T) {
	protected := []flashcardv2.EntityType{
		flashcardv2.EntityCard,
		flashcardv2.EntityReviewState,
		flashcardv2.EntityReviewSetMembership,
		flashcardv2.EntityTagAssignment,
		flashcardv2.EntityStudySession,
		flashcardv2.EntitySessionCard,
		flashcardv2.EntityLegacyCardAlias,
	}
	for _, entityType := range protected {
		t.Run(string(entityType), func(t *testing.T) {
			if err := validateFlashcardV2Mutations([]flashcardv2.EntityMutation{{
				EntityType: entityType,
				EntityID:   "entity-id",
				Deleted:    true,
			}}); err == nil {
				t.Fatalf("deleting protected flashcard entity type [%s] through the generic API was accepted", entityType)
			}
		})
	}
}

func TestValidateFlashcardV2MutationsAllowsPublicEntityDeletion(t *testing.T) {
	if err := validateFlashcardV2Mutations([]flashcardv2.EntityMutation{{
		EntityType: flashcardv2.EntityCardTemplate,
		EntityID:   "template-id",
		Deleted:    true,
	}}); err != nil {
		t.Fatalf("deleting a public flashcard entity through the generic API failed: %v", err)
	}
}

func TestApplyFlashcardV2SessionDefaultsUsesWorkspaceLimitsOnlyWithoutReviewSet(t *testing.T) {
	request := applyFlashcardV2SessionDefaults(flashcardv2.StudyQueueRequest{}, 23, 234)
	if request.NewLimit != 23 || request.ReviewLimit != 234 {
		t.Fatalf("global flashcard session did not use workspace limits: %+v", request)
	}
	explicit := applyFlashcardV2SessionDefaults(flashcardv2.StudyQueueRequest{NewLimit: 4, ReviewLimit: 5}, 23, 234)
	if explicit.NewLimit != 4 || explicit.ReviewLimit != 5 {
		t.Fatalf("explicit flashcard session limits were overwritten: %+v", explicit)
	}
	reviewSet := applyFlashcardV2SessionDefaults(flashcardv2.StudyQueueRequest{ReviewSetID: "review-set"}, 23, 234)
	if reviewSet.NewLimit != 0 || reviewSet.ReviewLimit != 0 {
		t.Fatalf("review set limits were replaced before loading the review set: %+v", reviewSet)
	}
}

func TestFlashcardV2AuthorityStateBlocksLegacyFallback(t *testing.T) {
	for state, expected := range map[string]bool{
		"":                                       false,
		flashcardv2.MigrationStateLegacy:         false,
		flashcardv2.MigrationStatePreparing:      true,
		flashcardv2.MigrationStateActive:         true,
		flashcardv2.MigrationStateLegacyDiverged: true,
	} {
		if actual := isFlashcardV2AuthorityState(state); actual != expected {
			t.Fatalf("unexpected V2 authority decision for state [%s]: got=%v want=%v", state, actual, expected)
		}
	}
}

func TestLegacyFlashcardV2QueueCountsOnlySelectedUnreviewedCards(t *testing.T) {
	card := func(id, state string, due int64) flashcardv2.LegacyQuickCard {
		return flashcardv2.LegacyQuickCard{Card: flashcardv2.Card{ID: id},
			ReviewState: flashcardv2.ReviewState{ReviewStateSnapshot: flashcardv2.ReviewStateSnapshot{State: state, Due: due}}}
	}
	cards := []flashcardv2.LegacyQuickCard{card("reviewed", "review", 1), card("old", "review", 2),
		card("new-a", "new", 3), card("new-b", "new", 4)}
	reviewed := map[string]struct{}{"reviewed": {}}
	selected, total, newCount, oldCount := selectLegacyFlashcardV2DueCards(cards, reviewed, 1, 1, 0)
	if len(selected) != 2 || selected[0].Card.ID != "reviewed" || selected[1].Card.ID != "new-a" ||
		total != 3 || newCount != 1 || oldCount != 0 {
		t.Fatalf("legacy queue counters include cards outside this round: selected=%+v total=%d new=%d old=%d",
			selected, total, newCount, oldCount)
	}
	selected, total, newCount, oldCount = selectLegacyFlashcardV2DueCards(cards, reviewed, 0, 0, 1)
	if len(selected) != 0 || total != 0 || newCount != 0 || oldCount != 0 {
		t.Fatalf("disabled queue limits retained pending counts: selected=%+v total=%d new=%d old=%d",
			selected, total, newCount, oldCount)
	}
}
