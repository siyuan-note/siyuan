// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package memo

import (
	"context"
	"errors"
	"testing"
)

func TestGuardedForgetDenialCancellationAndReplay(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	entry, err := s.Save(ctx, sample(), "missing", "original")
	if err != nil {
		t.Fatal(err)
	}
	denied := errors.New("source changed")
	if _, err = s.GuardedForget(ctx, entry.Record.ID, entry.Revision, "forget", func() error { return denied }); !errors.Is(err, denied) {
		t.Fatal(err)
	}
	calls := 0
	if _, err = s.GuardedForget(ctx, entry.Record.ID, entry.Revision, "forget", func() error {
		calls++
		if calls == 2 {
			return denied
		}
		return nil
	}); !errors.Is(err, denied) || calls != 2 {
		t.Fatalf("final guard not enforced: calls=%d err=%v", calls, err)
	}
	canceled, cancel := context.WithCancel(ctx)
	cancel()
	if _, err = s.GuardedForget(canceled, entry.Record.ID, entry.Revision, "forget", nil); !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
	if _, err = s.Get(ctx, entry.Record.ID); err != nil {
		t.Fatal("denied deletion changed record", err)
	}
	result, err := s.GuardedForget(ctx, entry.Record.ID, entry.Revision, "forget", func() error { return nil })
	if err != nil || result.WithdrawalID == "" {
		t.Fatalf("forget %+v %v", result, err)
	}
	reopened := NewStore(s.dataDir)
	retry, err := reopened.GuardedForget(ctx, entry.Record.ID, entry.Revision, "forget", func() error { return nil })
	if err != nil || retry.WithdrawalID != result.WithdrawalID {
		t.Fatalf("retry %+v %v", retry, err)
	}
	if _, err = reopened.Save(ctx, sample(), "missing", "original"); !errors.Is(err, ErrWithdrawn) {
		t.Fatalf("old operation revived: %v", err)
	}
}
