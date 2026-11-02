// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package agent

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/siyuan-note/siyuan/kernel/util"
)

func memoryReadFixture(t testing.TB) (string, string) {
	t.Helper()
	previous := util.DataDir
	util.DataDir = t.TempDir()
	t.Cleanup(func() { util.DataDir = previous })
	id := "20261101000000-session"
	dir := filepath.Join(sessionsDir(), id)
	if err := os.MkdirAll(dir, 0700); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, "session.json")
	return id, path
}

func TestMemoryConversationReadScopeIsPerRequest(t *testing.T) {
	id, path := memoryReadFixture(t)
	body := `{"lastCommittedTurnID":"committed","entries":[{"id":"one","type":"user","content":"original"},{"id":"two","type":"user","content":"original"}]}`
	if err := os.WriteFile(path, []byte(body), 0600); err != nil {
		t.Fatal(err)
	}
	ctx := newMemoryConversationScope(context.Background())
	if _, err := readMemoryConversation(ctx, id, "one"); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(strings.ReplaceAll(body, "original", "updated")), 0600); err != nil {
		t.Fatal(err)
	}
	text, err := readMemoryConversation(ctx, id, "two")
	if err != nil || !strings.Contains(text, "original") {
		t.Fatalf("same scope reread session: %s %v", text, err)
	}
	text, err = readMemoryConversation(newMemoryConversationScope(context.Background()), id, "two")
	if err != nil || !strings.Contains(text, "updated") {
		t.Fatalf("new request reused snapshot: %s %v", text, err)
	}
	if err = os.WriteFile(path, []byte(body+"garbage"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err = readMemoryConversation(context.Background(), id, "one"); err == nil {
		t.Fatal("early match bypassed corrupt trailing JSON")
	}
}

func TestMemoryConversationEvidenceRetainsExistingRevisionBytes(t *testing.T) {
	id, path := memoryReadFixture(t)
	body := `{"lastCommittedTurnID":"turn","snapshots":["ignored"],"entries":[{"id":"one","type":"user","content":"Concise replies","timestamp":123}]}`
	if err := os.WriteFile(path, []byte(body), 0600); err != nil {
		t.Fatal(err)
	}
	evidence, err := readMemoryConversation(context.Background(), id, "one")
	want := `{"sessionID":"20261101000000-session","entryID":"one","role":"user","content":"Concise replies","timestamp":123}`
	if err != nil || evidence != want {
		t.Fatalf("existing source revision bytes changed: %q %v", evidence, err)
	}
	if err = os.WriteFile(path, []byte(strings.Repeat(" ", 2*1024*1024)+body), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err = readMemoryConversation(context.Background(), id, "one"); err == nil {
		t.Fatal("session size budget bypassed")
	}
}

func TestMemoryConversationLockWaitCanBeCancelled(t *testing.T) {
	id, _ := memoryReadFixture(t)
	lock := sessionLock(id)
	lock.Lock()
	defer lock.Unlock()
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	finished := make(chan error, 1)
	go func() { _, err := readMemoryConversation(ctx, id, "one"); finished <- err }()
	select {
	case err := <-finished:
		if !errors.Is(err, context.DeadlineExceeded) {
			t.Fatalf("wrong cancellation: %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("read waits for session writer after cancellation")
	}
}

func TestMemoryConversationStreamingDecoderValidatesAllData(t *testing.T) {
	for _, text := range []string{
		`{"entries":[{"id":"one","type":"user","content":"ok"}],"lastCommittedTurnID":"turn","snapshots":[{"invalid":]}`,
		`{"entries":[],"entries":[],"lastCommittedTurnID":"turn"}`,
		`{"entries":[{"id":"one"},{"id":"one"}],"lastCommittedTurnID":"turn"}`,
		`{"entries":[],"lastCommittedTurnID":"turn"} {}`,
	} {
		if _, err := decodeMemoryConversation(context.Background(), []byte(text)); err == nil {
			t.Fatalf("accepted invalid checkpoint: %s", text)
		}
	}
	text := `{"snapshots":[{"nested":[1,true,null,"ignored"]}],"entries":[{"id":"one","type":"user","content":"ok","extra":{"ignored":[1,2]}}],"lastCommittedTurnID":"turn"}`
	snapshot, err := decodeMemoryConversation(context.Background(), []byte(text))
	if err != nil || snapshot.committed != "turn" || snapshot.entries["one"].Content != "ok" {
		t.Fatalf("valid existing format rejected: %+v %v", snapshot, err)
	}
}

func BenchmarkMemoryConversationReadBatch(b *testing.B) {
	id, path := memoryReadFixture(b)
	entries := make([]map[string]any, 25)
	for i := range entries {
		entries[i] = map[string]any{"id": fmt.Sprint(i), "type": "user", "content": strings.Repeat("content ", 100)}
	}
	data, err := json.Marshal(map[string]any{"lastCommittedTurnID": "turn", "entries": entries, "snapshots": []string{strings.Repeat("snapshot ", 20000)}})
	if err != nil {
		b.Fatal(err)
	}
	if err = os.WriteFile(path, data, 0600); err != nil {
		b.Fatal(err)
	}
	for _, cached := range []bool{false, true} {
		b.Run(fmt.Sprint("reuse=", cached), func(b *testing.B) {
			b.ReportAllocs()
			for i := 0; i < b.N; i++ {
				ctx := context.Background()
				if cached {
					ctx = newMemoryConversationScope(ctx)
				}
				for j := 0; j < 25; j++ {
					if _, err := readMemoryConversation(ctx, id, fmt.Sprint(j)); err != nil {
						b.Fatal(err)
					}
				}
			}
		})
	}
}
