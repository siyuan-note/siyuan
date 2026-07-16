// SiYuan - Refactor your thinking
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package kernelsync

import (
	"testing"
	"time"
)

func TestManagerScopesSessionsAndTerminalsByOwner(t *testing.T) {
	manager := NewManager[*int]()
	value := 42
	manager.Add("session", "plugin:a", &value)
	if session, ok := manager.Lookup("session", "plugin:a"); !ok || session == nil || *session != value {
		t.Fatalf("session lookup failed: %v %v", session, ok)
	}
	if _, ok := manager.Lookup("session", "plugin:b"); ok {
		t.Fatal("another owner accessed the session")
	}
	manager.RecordTerminal("session", "plugin:a", Terminal{Committed: true, Generation: 2, Changes: 1})
	if terminal, ok := manager.LookupTerminal("session", "plugin:a"); !ok || !terminal.Committed || terminal.Generation != 2 {
		t.Fatalf("terminal lookup failed: %+v %v", terminal, ok)
	}
	if _, ok := manager.LookupTerminal("session", "plugin:b"); ok {
		t.Fatal("another owner accessed the terminal")
	}
	manager.Delete("session", func(candidate *int) bool { return candidate == &value })
	if _, ok := manager.Lookup("session", "plugin:a"); ok {
		t.Fatal("session was not deleted")
	}
}

func TestManagerPrunesExpiredTerminal(t *testing.T) {
	manager := NewManager[int]()
	manager.RecordTerminal("expired", "owner", Terminal{ExpiresAt: time.Now().Add(-time.Second)})
	if _, ok := manager.LookupTerminal("expired", "owner"); ok {
		t.Fatal("expired terminal was retained")
	}
}
