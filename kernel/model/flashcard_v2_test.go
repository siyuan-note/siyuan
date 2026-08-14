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
