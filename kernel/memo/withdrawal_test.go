// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package memo

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestMemoryWithdrawalPreservesOtherFactsFromSameSource(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	r := sample()
	coffee, err := s.Save(ctx, r, "missing", "coffee")
	if err != nil {
		t.Fatal(err)
	}
	r.Content = "My project uses Go"
	project, err := s.Save(ctx, r, "missing", "project")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.Forget(ctx, coffee.Record.ID, coffee.Revision, "forget-coffee"); err != nil {
		t.Fatal(err)
	}
	if current, readErr := NewStore(s.dataDir).Get(ctx, project.Record.ID); readErr != nil || current.Revision != project.Revision {
		t.Fatalf("forgetting one fact withdrew or rewrote its sibling: %+v %v", current, readErr)
	}
	result, err := s.Search(ctx, SearchOptions{Limit: 100})
	if err != nil || len(result.Entries) != 1 || result.Entries[0].Record.ID != project.Record.ID {
		t.Fatalf("sibling disappeared from retrieval: %+v %v", result, err)
	}
	if _, err = s.Save(ctx, sample(), "missing", "delayed-reextract"); !errors.Is(err, ErrWithdrawn) {
		t.Fatalf("forgotten source was automatically re-extracted: %v", err)
	}
	if _, err = s.Forget(ctx, project.Record.ID, project.Revision, "forget-project"); err != nil {
		t.Fatal(err)
	}
}

func TestMemoryWithdrawalDoesNotPreserveDuplicateFact(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	target := saveSample(t, s, "first")
	duplicate := saveSample(t, s, "duplicate")
	forgot, err := s.Forget(ctx, target.Record.ID, target.Revision, "forget")
	if err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(filepath.Join(s.dataDir, "storage/ai/memos/withdrawals", forgot.WithdrawalID+".md"))
	if err != nil {
		t.Fatal(err)
	}
	var w withdrawal
	if _, err = decode(data, &w); err != nil || w.Schema != 1 || len(w.Survivors) != 0 {
		t.Fatalf("withdrawal without preserved facts requires an unnecessary format upgrade: %+v %v", w, err)
	}
	if _, err := s.Get(ctx, duplicate.Record.ID); !errors.Is(err, ErrWithdrawn) {
		t.Fatalf("duplicate forgotten fact remained usable: %v", err)
	}
}

func TestMemoryWithdrawalPreservationSurvivesRestore(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	target := saveSample(t, s, "target")
	r := sample()
	r.Content = "Another existing fact"
	sibling, err := s.Save(ctx, r, "missing", "sibling")
	if err != nil {
		t.Fatal(err)
	}
	forgot, err := s.Forget(ctx, target.Record.ID, target.Revision, "forget")
	if err != nil {
		t.Fatal(err)
	}
	name := filepath.Join(s.dataDir, "storage/ai/memos/withdrawals", forgot.WithdrawalID+".md")
	data, err := os.ReadFile(name)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.PreserveWithdrawal(ctx, data, forgot.WithdrawalID); err != nil {
		t.Fatal(err)
	}
	if err = os.Remove(name); err != nil {
		t.Fatal(err)
	}
	if _, err = NewStore(s.dataDir).Get(ctx, sibling.Record.ID); err != nil {
		t.Fatalf("protected withdrawal lost its sibling authorization: %v", err)
	}
	raw, err := encode(target.Record, target.Record.Content)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(s.dataDir, "storage/ai/memos/records", target.Record.ID+".md"), raw, 0600); err != nil {
		t.Fatal(err)
	}
	if _, err = s.Get(ctx, target.Record.ID); !errors.Is(err, ErrWithdrawn) {
		t.Fatalf("restored target became usable: %v", err)
	}
	r = sibling.Record
	r.Content = target.Record.Content
	if _, err = s.Save(ctx, r, sibling.Revision, "overwrite-sibling"); !errors.Is(err, ErrWithdrawn) {
		t.Fatalf("sibling identity bypassed fact suppression: %v", err)
	}
}

func TestMemoryWithdrawalFormatValidation(t *testing.T) {
	w := withdrawal{Schema: 2, ID: NewID(), Target: NewID(), Sources: []Source{{Kind: "user", ID: "request", Revision: "one"}}, Operation: "forget", Created: time.Now().UTC().Format(time.RFC3339Nano)}
	id := NewID()
	for _, tc := range []struct {
		name      string
		schema    int
		survivors []withdrawalSurvivor
		valid     bool
	}{
		{"legacy", 1, nil, true},
		{"current-empty", 2, nil, true},
		{"current", 2, []withdrawalSurvivor{{ID: id, Fact: withdrawalFact(sample())}}, true},
		{"legacy-extension", 1, []withdrawalSurvivor{{ID: id, Fact: withdrawalFact(sample())}}, false},
		{"unknown-format", 3, nil, false},
		{"target-exemption", 2, []withdrawalSurvivor{{ID: w.Target, Fact: withdrawalFact(sample())}}, false},
		{"invalid-id", 2, []withdrawalSurvivor{{ID: "invalid", Fact: withdrawalFact(sample())}}, false},
		{"invalid-fact", 2, []withdrawalSurvivor{{ID: id, Fact: "invalid"}}, false},
		{"duplicate", 2, []withdrawalSurvivor{{ID: id, Fact: withdrawalFact(sample())}, {ID: id, Fact: withdrawalFact(sample())}}, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			w.Schema, w.Survivors = tc.schema, tc.survivors
			data, err := encode(w, "")
			if err != nil {
				t.Fatal(err)
			}
			if err = ValidateWithdrawal(data, w.ID); (err == nil) != tc.valid {
				t.Fatalf("withdrawal format validation: %v", err)
			}
		})
	}
}

func TestMemoryWithdrawalV1FixtureKeepsConservativeSuppression(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	r := sample()
	r.Content = "A separate fact without a retained legacy authorization"
	r.Sources = []Source{{Kind: "user", ID: "legacy-request", Revision: "version-one"}}
	entry, err := s.Save(ctx, r, "missing", "legacy-sibling")
	if err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile("testdata/withdrawal-v1.md")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.PreserveWithdrawal(ctx, data, "20261029000000-abcdefg"); err != nil {
		t.Fatal(err)
	}
	if _, err = s.Get(ctx, entry.Record.ID); !errors.Is(err, ErrWithdrawn) {
		t.Fatalf("upgrade weakened legacy suppression: %v", err)
	}
	if _, err = s.Remember(ctx, r, "missing", "legacy-request"); !errors.Is(err, ErrWithdrawn) {
		t.Fatalf("legacy explicit operation replayed: %v", err)
	}
	r.ID = ""
	if _, err = s.Remember(ctx, r, "missing", "fresh-explicit-request"); err != nil {
		t.Fatalf("fresh explicit authorization unavailable: %v", err)
	}
}
