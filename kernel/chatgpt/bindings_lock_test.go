// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package chatgpt

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/gofrs/flock"
)

func TestChatGPTBindingsLockCancellationAndRecovery(t *testing.T) {
	s, workspace := Open(t.TempDir()), t.TempDir()
	if err := s.SaveBindings(context.Background(), workspace, map[string]string{"provider": "original"}); err != nil {
		t.Fatal(err)
	}
	path, err := s.BindingPath(workspace)
	if err != nil {
		t.Fatal(err)
	}
	lock := flock.New(path + ".lock")
	if err = lock.Lock(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = lock.Unlock() })
	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Millisecond)
	defer cancel()
	writes := 0
	err = s.UpdateBindings(ctx, workspace, map[string]string{"provider": "blocked"}, func(string, []byte) error {
		writes++
		return nil
	})
	if !errors.Is(err, context.DeadlineExceeded) || writes != 0 {
		t.Fatalf("blocked update: err=%v, writes=%d", err, writes)
	}
	if err = lock.Unlock(); err != nil {
		t.Fatal(err)
	}
	err = s.UpdateBindings(ctx, workspace, nil, func(string, []byte) error {
		writes++
		return nil
	})
	if !errors.Is(err, context.DeadlineExceeded) || writes != 0 {
		t.Fatalf("expired update after release: err=%v, writes=%d", err, writes)
	}
	got, err := s.LoadBindings(workspace)
	if err != nil || got["provider"] != "original" {
		t.Fatalf("canceled update changed bindings: %v, %v", got, err)
	}
	if err = s.SaveBindings(context.Background(), workspace, map[string]string{"provider": "recovered"}); err != nil {
		t.Fatal(err)
	}
	got, err = s.LoadBindings(workspace)
	if err != nil || got["provider"] != "recovered" {
		t.Fatalf("lock recovery failed: %v, %v", got, err)
	}
}
