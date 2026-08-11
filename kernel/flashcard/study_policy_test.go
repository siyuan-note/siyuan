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
	"errors"
	"testing"
)

func TestSaveStudyPolicyUsesStableScopeIdentityAndProtectsRevisions(t *testing.T) {
	ctx := context.Background()
	store := newGenerationTestStore(t, ctx)
	defer store.Close()
	targetDate := int64(1787000000000)
	request := SaveStudyPolicyRequest{OperationID: "create-study-policy", ScopeType: "document",
		ScopeID: "document-1", Priority: "exam", TargetDate: &targetDate, UpdatedAt: 10}
	created, err := store.SaveStudyPolicy(ctx, request)
	if err != nil {
		t.Fatal(err)
	}
	if created.EntityID != DeterministicID("study-policy", request.ScopeType, request.ScopeID) {
		t.Fatalf("study policy did not use its stable scope identity: %+v", created)
	}
	retry, err := store.SaveStudyPolicy(ctx, request)
	if err != nil || retry.RevisionID != created.RevisionID {
		t.Fatalf("study policy retry was not idempotent: revision=%+v err=%v", retry, err)
	}
	current, found, err := store.Projection().StudyPolicyRevision(ctx, request.ScopeType, request.ScopeID)
	if err != nil || !found || current.RevisionID != created.RevisionID {
		t.Fatalf("study policy could not be resolved by scope: revision=%+v found=%v err=%v", current, found, err)
	}
	request.OperationID = "overwrite-study-policy"
	request.Priority = "learning"
	request.UpdatedAt = 11
	if _, err = store.SaveStudyPolicy(ctx, request); !errors.Is(err, ErrRevisionConflict) {
		t.Fatalf("study policy update without an expected revision was accepted: %v", err)
	}
	request.OperationID = "update-study-policy"
	request.ExpectedRevisionID = created.RevisionID
	updated, err := store.SaveStudyPolicy(ctx, request)
	if err != nil || len(updated.ParentRevisionIDs) != 1 || updated.ParentRevisionIDs[0] != created.RevisionID {
		t.Fatalf("study policy update did not preserve revision ancestry: revision=%+v err=%v", updated, err)
	}
}
