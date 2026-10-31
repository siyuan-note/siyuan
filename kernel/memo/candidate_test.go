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

func saveCandidateAt(t *testing.T, s *Store, r Record, updated time.Time, op string) Entry {
	t.Helper()
	entry, err := s.Save(context.Background(), r, "missing", op)
	if err != nil {
		t.Fatal(err)
	}
	entry.Record.Created, entry.Record.Updated = updated.Format(time.RFC3339Nano), updated.Format(time.RFC3339Nano)
	data, err := encode(entry.Record, entry.Record.Content)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(s.dataDir, "storage/ai/memos/records", entry.Record.ID+".md"), data, 0600); err != nil {
		t.Fatal(err)
	}
	entry, err = DecodeRecord(data, entry.Record.ID)
	if err != nil {
		t.Fatal(err)
	}
	return entry
}

func autoCandidate() Record {
	r := sample()
	r.State = "candidate"
	r.Sources = []Source{{Kind: "block", ID: "20261031000000-abcdefg", Revision: "one", Evidence: r.Content}}
	return r
}

func TestCandidateRetentionProtectsManualAndUsableRecords(t *testing.T) {
	now := time.Now().UTC()
	for _, tc := range []struct {
		name, state, source string
		age                 time.Duration
		confirmed, remove   bool
	}{
		{"old", "candidate", "block", 31 * 24 * time.Hour, false, true},
		{"boundary", "candidate", "conversation", 30 * 24 * time.Hour, false, true},
		{"recent", "candidate", "block", 29 * 24 * time.Hour, false, false},
		{"manual", "candidate", "user", 90 * 24 * time.Hour, false, false},
		{"unknown", "candidate", "legacy", 90 * 24 * time.Hour, false, false},
		{"confirmed", "candidate", "block", 90 * 24 * time.Hour, true, false},
		{"active", "active", "block", 90 * 24 * time.Hour, false, false},
		{"review", "review", "block", 90 * 24 * time.Hour, false, false},
		{"disabled", "disabled", "block", 90 * 24 * time.Hour, false, false},
		{"superseded", "superseded", "block", 90 * 24 * time.Hour, false, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s := newTestStore(t)
			r := autoCandidate()
			r.State, r.Sources[0].Kind = tc.state, tc.source
			if tc.confirmed {
				r.Confirmed = now.Format(time.RFC3339Nano)
			}
			entry := saveCandidateAt(t, s, r, now.Add(-tc.age), tc.name)
			n, err := s.MaintainCandidates(context.Background(), now.Add(-30*24*time.Hour), nil)
			if err != nil || (n == 1) != tc.remove {
				t.Fatalf("cleanup n=%d err=%v", n, err)
			}
			current, err := s.Get(context.Background(), entry.Record.ID)
			if tc.remove {
				if err == nil {
					t.Fatal("expired candidate remains")
				}
			} else if err != nil || current.Revision != entry.Revision {
				t.Fatalf("protected record changed: %v", err)
			}
		})
	}
}

func TestCandidateCleanupBlocksRestoreWithoutWithdrawingSource(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	r := autoCandidate()
	entry := saveCandidateAt(t, s, r, time.Now().Add(-31*24*time.Hour), "old-operation")
	raw, err := encode(entry.Record, entry.Record.Content)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.MaintainCandidates(ctx, time.Now().Add(-30*24*time.Hour), nil); err != nil {
		t.Fatal(err)
	}
	if _, err = s.Save(ctx, r, "missing", "new-source-processing"); err != nil {
		t.Fatalf("candidate cleanup withdrew its whole source: %v", err)
	}
	if _, err = s.Save(ctx, r, "missing", "old-operation"); !errors.Is(err, ErrWithdrawn) {
		t.Fatalf("old request replayed: %v", err)
	}
	name := filepath.Join(s.dataDir, "storage/ai/memos/records", entry.Record.ID+".md")
	if err = os.WriteFile(name, raw, 0600); err != nil {
		t.Fatal(err)
	}
	if _, err = NewStore(s.dataDir).Get(ctx, entry.Record.ID); !errors.Is(err, ErrWithdrawn) {
		t.Fatalf("restored expired candidate became readable: %v", err)
	}
	if _, err = s.MaintainCandidates(ctx, time.Now().Add(-30*24*time.Hour), nil); err != nil {
		t.Fatal(err)
	}
	if _, err = os.Stat(name); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("retry left withdrawn candidate on disk: %v", err)
	}
}

func TestCandidateDeduplicationPreservesDifferentEvidence(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	r := autoCandidate()
	for i, evidence := range []string{r.Content, r.Content, "Additional independent evidence"} {
		r.Sources[0].Evidence = evidence
		if _, err := s.Save(ctx, r, "missing", string(rune('a'+i))); err != nil {
			t.Fatal(err)
		}
	}
	n, err := s.MaintainCandidates(ctx, time.Now().Add(-30*24*time.Hour), nil)
	if err != nil || n != 1 {
		t.Fatalf("dedup n=%d err=%v", n, err)
	}
	result, err := s.Search(ctx, SearchOptions{States: []string{"candidate"}})
	if err != nil || len(result.Entries) != 2 {
		t.Fatalf("independent evidence lost: %+v %v", result, err)
	}
}

func TestCandidateRepeatedOperationDoesNotRenewRetention(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	entry := saveCandidateAt(t, s, autoCandidate(), time.Now().Add(-31*24*time.Hour), "first")
	updated, err := s.Save(ctx, entry.Record, entry.Revision, "repeat")
	if err != nil || updated.Record.Updated != entry.Record.Updated || len(updated.Record.Operations) != 2 {
		t.Fatalf("unchanged candidate renewed: %+v %v", updated, err)
	}
	r := updated.Record
	r.Sources = append([]Source{}, r.Sources...)
	r.Sources[0].Revision = "new-version"
	changed, err := s.Save(ctx, r, updated.Revision, "new-evidence")
	if err != nil || changed.Record.Updated == updated.Record.Updated {
		t.Fatalf("new evidence did not renew retention: %v", err)
	}
}

func TestCandidateDiscardChecksRevisionAndFinalGuard(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	entry := saveCandidateAt(t, s, autoCandidate(), time.Now().Add(-31*24*time.Hour), "first")
	denied := errors.New("disabled")
	calls := 0
	_, err := s.GuardedDiscardCandidate(ctx, entry.Record.ID, entry.Revision, "discard", func() error {
		calls++
		if calls > 1 {
			return denied
		}
		return nil
	})
	if !errors.Is(err, denied) {
		t.Fatalf("final guard ignored: %v", err)
	}
	r := entry.Record
	r.State = "active"
	changed, err := s.Save(ctx, r, entry.Revision, "activate")
	if err != nil {
		t.Fatal(err)
	}
	for _, rev := range []string{entry.Revision, changed.Revision} {
		if _, err = s.GuardedDiscardCandidate(ctx, entry.Record.ID, rev, "discard", nil); !errors.Is(err, ErrConflict) {
			t.Fatalf("active record discarded: %v", err)
		}
	}
}
