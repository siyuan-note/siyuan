// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package memo

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestMemoryForgottenExplicitOperationCannotReplay(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	first, err := s.Remember(ctx, sample(), "missing", "original-request")
	if err != nil {
		t.Fatal(err)
	}
	r := first.Record
	r.Content += " for normal answers"
	updated, err := s.Remember(ctx, r, first.Revision, "update-request")
	if err != nil {
		t.Fatal(err)
	}
	forgot, err := s.Forget(ctx, updated.Record.ID, updated.Revision, "forget-request")
	if err != nil {
		t.Fatal(err)
	}
	checkRetries := func() {
		t.Helper()
		for _, op := range []string{"original-request", "update-request", "forget-request"} {
			if _, retryErr := s.Remember(ctx, sample(), "missing", op); !errors.Is(retryErr, ErrWithdrawn) {
				t.Fatalf("forgotten explicit operation %q revived: %v", op, retryErr)
			}
		}
	}
	checkRetries()
	name := filepath.Join(s.dataDir, "storage/ai/memos/withdrawals", forgot.WithdrawalID+".md")
	data, err := os.ReadFile(name)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(data), "original-request") || strings.Contains(string(data), "update-request") {
		t.Fatal("prior operation identities were not hashed")
	}
	if _, err = s.PreserveWithdrawal(ctx, data, forgot.WithdrawalID); err != nil {
		t.Fatal(err)
	}
	if err = os.Remove(name); err != nil {
		t.Fatal(err)
	}
	checkRetries()
	if _, err = s.Remember(ctx, sample(), "missing", "new-user-request"); err != nil {
		t.Fatalf("fresh explicit remember rejected: %v", err)
	}
}

func TestMemoryLegacyWithdrawalCompatibility(t *testing.T) {
	w := withdrawal{Schema: 1, ID: NewID(), Target: NewID(), Sources: []Source{{Kind: "user", ID: "legacy-create", Revision: "r1"}}, Operation: "forget", Created: time.Now().UTC().Format(time.RFC3339Nano)}
	// 与增加 operationHashes 前的结构保持完全相同，已有重新记住授权不能失效。
	legacy := struct {
		Schema    int
		ID        string
		Target    string
		Sources   []Source
		Operation string
		Created   string
	}{w.Schema, "", w.Target, w.Sources, w.Operation, w.Created}
	oldBytes, err := json.Marshal(legacy)
	if err != nil {
		t.Fatal(err)
	}
	if withdrawalAuthorization(w) != revision(oldBytes) {
		t.Fatal("legacy authorization fingerprint changed")
	}
	data, err := encode(w, "")
	if err != nil || ValidateWithdrawal(data, w.ID) != nil {
		t.Fatalf("legacy withdrawal rejected: %v", err)
	}
	s := newTestStore(t)
	if _, err = s.PreserveWithdrawal(context.Background(), data, w.ID); err != nil {
		t.Fatal(err)
	}
	if _, err = s.Remember(context.Background(), sample(), "missing", "legacy-create"); !errors.Is(err, ErrWithdrawn) {
		t.Fatalf("legacy user source operation replayed: %v", err)
	}
	for _, hashes := range [][]string{{"invalid"}, {revision([]byte("old")), revision([]byte("old"))}} {
		w.OperationHashes = hashes
		data, err = encode(w, "")
		if err != nil {
			t.Fatal(err)
		}
		if !errors.Is(ValidateWithdrawal(data, w.ID), ErrInvalid) {
			t.Fatal("invalid operation hashes accepted")
		}
	}
}

func sample() Record {
	return Record{Kind: "preference", Subject: "user", Scope: "workspace", State: "active", Sources: []Source{{Kind: "message", ID: "message-1", Revision: "r1", Evidence: "Please use concise replies"}}, Content: "User prefers concise replies"}
}
func newTestStore(t *testing.T) *Store { t.Helper(); return NewStore(t.TempDir()) }
func saveSample(t *testing.T, s *Store, op string) Entry {
	t.Helper()
	entry, err := s.Save(context.Background(), sample(), "missing", op)
	if err != nil {
		t.Fatal(err)
	}
	return entry
}
func TestMemoryCASAndOperationHistory(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	first := saveSample(t, s, "op1")
	again, err := s.Save(ctx, sample(), "missing", "op1")
	if err != nil || again.Record.ID != first.Record.ID {
		t.Fatalf("idempotence %v", err)
	}
	r := first.Record
	r.Content = "Detailed replies for tutorials"
	second, err := s.Save(ctx, r, first.Revision, "op2")
	if err != nil {
		t.Fatal(err)
	}
	if len(second.Record.Operations) != 2 {
		t.Fatal("lost operation history")
	}
	if _, err = s.Save(ctx, r, first.Revision, "op3"); !errors.Is(err, ErrConflict) {
		t.Fatalf("stale revision: %v", err)
	}
	again, err = s.Save(ctx, sample(), "missing", "op1")
	if err != nil || again.Record.ID != first.Record.ID || again.Revision != second.Revision {
		t.Fatalf("old retry %v", err)
	}
}
func TestMemoryConcurrentCAS(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	entry := saveSample(t, s, "op1")
	var wg sync.WaitGroup
	var mu sync.Mutex
	success, conflicts := 0, 0
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			r := entry.Record
			r.Content = fmt.Sprintf("value %d", i)
			_, err := NewStore(s.dataDir).Save(ctx, r, entry.Revision, fmt.Sprint("update-", i))
			mu.Lock()
			defer mu.Unlock()
			if err == nil {
				success++
			} else if errors.Is(err, ErrConflict) {
				conflicts++
			} else {
				t.Errorf("unexpected %v", err)
			}
		}(i)
	}
	wg.Wait()
	if success != 1 || conflicts != 7 {
		t.Fatalf("success %d conflicts %d", success, conflicts)
	}
}
func TestMemoryWithdrawalsAndExplicitRemember(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	entry := saveSample(t, s, "op1")
	result, err := s.Forget(ctx, entry.Record.ID, entry.Revision, "forget")
	if err != nil || result.CleanupPending {
		t.Fatal(err)
	}
	if _, err = s.Save(ctx, sample(), "missing", "retry"); !errors.Is(err, ErrWithdrawn) {
		t.Fatalf("source revival %v", err)
	}
	r := sample()
	r.Sources[0].Revision = "r2"
	if _, err = s.Save(ctx, r, "missing", "new-version"); !errors.Is(err, ErrWithdrawn) {
		t.Fatalf("revision bypass %v", err)
	}
	r = entry.Record
	if _, err = s.Remember(ctx, r, "missing", "old-id"); !errors.Is(err, ErrWithdrawn) {
		t.Fatalf("target revival %v", err)
	}
	remembered, err := s.Remember(ctx, sample(), "missing", "explicit-new")
	if err != nil {
		t.Fatal(err)
	}
	if remembered.Record.ID == entry.Record.ID || len(remembered.Record.Authorizations) == 0 {
		t.Fatal("missing explicit new identity")
	}
	raw, err := os.ReadFile(filepath.Join(s.dataDir, "storage/ai/memos/withdrawals", result.WithdrawalID+".md"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), "concise") {
		t.Fatal("forgotten content retained in withdrawal")
	}
	retry, err := s.Forget(ctx, entry.Record.ID, entry.Revision, "forget")
	if err != nil || retry.WithdrawalID != result.WithdrawalID {
		t.Fatalf("retry: %v", err)
	}
}
func TestMemoryProjectionInvalidationAndScope(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	saveSample(t, s, "op1")
	snapshot, err := s.Snapshot(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err = s.SaveProjection(ctx, "MEMORY.md", "Concise replies", snapshot.Fingerprint, nil); err != nil {
		t.Fatal(err)
	}
	if _, err = s.ReadProjection(ctx, "MEMORY.md", nil); err != nil {
		t.Fatal(err)
	}
	if _, err = s.ReadProjection(ctx, "MEMORY.md", []string{"other-project"}); !errors.Is(err, ErrConflict) {
		t.Fatalf("scope leak %v", err)
	}
	r := sample()
	r.Sources[0].ID = "another"
	r.Content = "Another fact"
	if _, err = s.Save(ctx, r, "missing", "op2"); err != nil {
		t.Fatal(err)
	}
	if _, err = s.ReadProjection(ctx, "MEMORY.md", nil); !errors.Is(err, ErrConflict) {
		t.Fatalf("new record must invalidate %v", err)
	}
	if err = s.SaveProjection(ctx, "MEMORY.md", "stale", snapshot.Fingerprint, nil); !errors.Is(err, ErrConflict) {
		t.Fatalf("stale generation committed %v", err)
	}
}
func TestMemoryStrictMetadata(t *testing.T) {
	s := newTestStore(t)
	entry := saveSample(t, s, "op")
	data, err := encode(entry.Record, entry.Record.Content)
	if err != nil {
		t.Fatal(err)
	}
	tests := map[string]string{"unknown": strings.Replace(string(data), "schema: 1", "schema: 1\nunknown: x", 1), "duplicate": strings.Replace(string(data), "schema: 1", "schema: 1\nschema: 1", 1), "alias": strings.Replace(string(data), "subject: user", "subject: &u user\nreason: *u", 1), "type": strings.Replace(string(data), "subject: user", "subject: 42", 1), "version": strings.Replace(string(data), "schema: 1", "schema: 2", 1), "tag": strings.Replace(string(data), "subject: user", "subject: !run user", 1)}
	for name, text := range tests {
		t.Run(name, func(t *testing.T) {
			if _, err := DecodeRecord([]byte(text), entry.Record.ID); err == nil {
				t.Fatal("accepted malformed metadata")
			}
		})
	}
	if _, err = DecodeRecord(data, NewID()); err == nil {
		t.Fatal("accepted mismatched ID")
	}
}
func TestMemoryCorruptIsolationAndPagination(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	for i := 0; i < 5; i++ {
		saveSample(t, s, fmt.Sprint(i))
	}
	root := filepath.Join(s.dataDir, "storage/ai/memos/records")
	if err := os.WriteFile(filepath.Join(root, NewID()+".md"), []byte("corrupt"), 0600); err != nil {
		t.Fatal(err)
	}
	result, err := s.Search(ctx, SearchOptions{Limit: 2, Offset: 2})
	if err != nil || len(result.Entries) != 2 || !result.Incomplete || len(result.Errors) != 1 {
		t.Fatalf("result %+v err %v", result, err)
	}
	if _, err = s.Snapshot(ctx, nil); !errors.Is(err, ErrIncomplete) {
		t.Fatal("incomplete snapshot trusted")
	}
}
func TestMemoryConflictQuarantine(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	entry := saveSample(t, s, "op")
	data, _ := encode(entry.Record, entry.Record.Content)
	if err := s.Quarantine(ctx, entry.Record.ID, [][]byte{data, []byte("other version")}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Get(ctx, entry.Record.ID); !errors.Is(err, ErrConflict) {
		t.Fatalf("conflict used %v", err)
	}
	result, err := s.Search(ctx, SearchOptions{})
	if err != nil || len(result.Entries) != 0 {
		t.Fatal("conflict returned")
	}
	if _, err = s.Save(ctx, entry.Record, entry.Revision, "update"); !errors.Is(err, ErrConflict) {
		t.Fatal("conflict overwritten")
	}
}
func TestMemorySymlinkAndCancellation(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	outside := t.TempDir()
	if err := os.Symlink(outside, filepath.Join(s.dataDir, "storage")); err != nil {
		t.Skip(err)
	}
	if _, err := s.Save(ctx, sample(), "missing", "op"); err == nil {
		t.Fatal("followed storage link")
	}
	s = newTestStore(t)
	entry := saveSample(t, s, "op")
	path := filepath.Join(s.dataDir, "storage/ai/memos/records", entry.Record.ID+".md")
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(outside, "secret"), path); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Get(ctx, entry.Record.ID); err == nil {
		t.Fatal("followed record link")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := s.Save(ctx, sample(), "missing", "cancel"); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancellation %v", err)
	}
}

func TestMemoryPreservedWithdrawalKeepsExplicitAuthorization(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	first := saveSample(t, s, "first")
	forgot, err := s.Forget(ctx, first.Record.ID, first.Revision, "forget")
	if err != nil {
		t.Fatal(err)
	}
	remembered, err := s.Remember(ctx, sample(), "missing", "remember-again")
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(s.dataDir, "storage/ai/memos/withdrawals", forgot.WithdrawalID+".md")
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.PreserveWithdrawal(ctx, data, forgot.WithdrawalID); err != nil {
		t.Fatal(err)
	}
	if err = os.Remove(path); err != nil {
		t.Fatal(err)
	}
	if _, err = s.Get(ctx, remembered.Record.ID); err != nil {
		t.Fatalf("valid explicit authorization lost after preserve: %v", err)
	}
}

func TestMemorySnapshotLimitAndBoundedResults(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	entry := saveSample(t, s, "seed")
	dir := filepath.Join(s.dataDir, "storage/ai/memos/records")
	for i := 0; i < MaxResults; i++ {
		r := entry.Record
		r.ID = NewID()
		r.Operations = []string{fmt.Sprint("fixture-", i)}
		data, err := encode(r, r.Content)
		if err != nil {
			t.Fatal(err)
		}
		if err = os.WriteFile(filepath.Join(dir, r.ID+".md"), data, 0600); err != nil {
			t.Fatal(err)
		}
	}
	result, err := s.Search(ctx, SearchOptions{})
	if err != nil || len(result.Entries) != MaxResults || !result.Incomplete {
		t.Fatalf("unbounded result: %d %v", len(result.Entries), err)
	}
	snapshot, err := s.Snapshot(ctx, nil)
	if err != nil || !snapshot.Partial || snapshot.RecordCount != MaxResults+1 || len(snapshot.Entries) != MaxResults {
		t.Fatalf("snapshot budget: %+v %v", snapshot, err)
	}
	extra := entry.Record
	extra.ID = "29990101000000-zzzzzzz"
	extra.Operations = []string{"after-budget"}
	data, err := encode(extra, extra.Content)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(dir, extra.ID+".md"), data, 0600); err != nil {
		t.Fatal(err)
	}
	changed, err := s.Snapshot(ctx, nil)
	if err != nil || changed.Fingerprint == snapshot.Fingerprint || changed.RecordCount != MaxResults+2 || len(changed.Entries) != MaxResults {
		t.Fatalf("full set fingerprint missed record after budget: %v", err)
	}
	if err = os.Remove(filepath.Join(dir, extra.ID+".md")); err != nil {
		t.Fatal(err)
	}
	tail, err := s.Search(ctx, SearchOptions{Offset: MaxResults})
	if err != nil || len(tail.Entries) != 1 || tail.Incomplete {
		t.Fatalf("tail: %+v %v", tail, err)
	}
}
func TestMemoryCannotForgeAuthorizationOrOperationHistory(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	entry := saveSample(t, s, "first")
	if _, err := s.Forget(ctx, entry.Record.ID, entry.Revision, "forget"); err != nil {
		t.Fatal(err)
	}
	root, err := s.root(false)
	if err != nil {
		t.Fatal(err)
	}
	ws, err := s.withdrawals(ctx, root)
	root.Close()
	if err != nil {
		t.Fatal(err)
	}
	r := sample()
	r.Authorizations = []string{withdrawalAuthorization(ws[0])}
	r.Operations = []string{"already-authorized"}
	if _, err = s.Save(ctx, r, "missing", "forged"); !errors.Is(err, ErrWithdrawn) {
		t.Fatal("caller-provided withdrawal authorization accepted")
	}
}

func TestMemoryFinalGuardRejectsWrite(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	blocked := errors.New("configuration changed")
	calls := 0
	_, err := s.GuardedSave(ctx, sample(), "missing", "guard", func() error { calls++; return blocked })
	if !errors.Is(err, blocked) || calls != 1 {
		t.Fatalf("guard: %v %d", err, calls)
	}
	result, err := s.Search(ctx, SearchOptions{})
	if err != nil || len(result.Entries) != 0 {
		t.Fatal("guard rejection persisted record")
	}
}

func TestMemoryOperationManifestStableKeys(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	source := revision([]byte("source"))
	a, b := revision([]byte("action A")), revision([]byte("action B"))
	if err := s.PrepareOperation(ctx, "batch", source, []string{a, b}); err != nil {
		t.Fatal(err)
	}
	if err := s.PrepareOperation(ctx, "batch", source, []string{b, a}); err != nil {
		t.Fatalf("reorder should be stable: %v", err)
	}
	if err := s.PrepareOperation(ctx, "batch", source, []string{a}); !errors.Is(err, ErrConflict) {
		t.Fatal("changed batch accepted")
	}
	if err := s.PrepareOperation(ctx, "batch", revision([]byte("changed source")), []string{a, b}); !errors.Is(err, ErrConflict) {
		t.Fatal("changed source accepted")
	}
	if err := s.PrepareOperation(ctx, "batch2", source, []string{"private plaintext"}); !errors.Is(err, ErrInvalid) {
		t.Fatal("plaintext action key accepted")
	}
}

func TestMemoryActiveStateStillChecksValidity(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	expired := sample()
	expired.ValidUntil = time.Now().Add(-time.Hour).UTC().Format(time.RFC3339Nano)
	if _, err := s.Save(ctx, expired, "missing", "expired"); err != nil {
		t.Fatal(err)
	}
	future := sample()
	future.ValidFrom = time.Now().Add(time.Hour).UTC().Format(time.RFC3339Nano)
	if _, err := s.Save(ctx, future, "missing", "future"); err != nil {
		t.Fatal(err)
	}
	result, err := s.Search(ctx, SearchOptions{States: []string{"active"}})
	if err != nil || len(result.Entries) != 0 {
		t.Fatalf("inactive validity injected: %+v %v", result, err)
	}
	management, err := s.Search(ctx, SearchOptions{States: []string{"active"}, IncludeInactiveValidity: true})
	if err != nil || len(management.Entries) != 2 {
		t.Fatalf("management cannot inspect inactive records: %+v %v", management, err)
	}
}
