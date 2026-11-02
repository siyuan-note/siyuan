// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package agent

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"sync"
	"time"

	"github.com/siyuan-note/siyuan/kernel/util"
)

type memoryConversationEntry struct {
	ID            string         `json:"id"`
	Type          string         `json:"type"`
	Content       string         `json:"content"`
	Timestamp     int64          `json:"timestamp"`
	References    []Reference    `json:"references"`
	EditorContext *EditorContext `json:"editorContext"`
}
type memoryConversationSnapshot struct {
	committed string
	entries   map[string]memoryConversationEntry
}
type memoryConversationResult struct {
	snapshot memoryConversationSnapshot
	err      error
}
type memoryConversationScopeKey struct{}
type memoryConversationScope struct {
	sync.Mutex
	workspace string
	sessions  map[string]memoryConversationResult
}

func newMemoryConversationScope(ctx context.Context) context.Context {
	return context.WithValue(ctx, memoryConversationScopeKey{}, &memoryConversationScope{workspace: util.DataDir, sessions: map[string]memoryConversationResult{}})
}

func memoryConversationForRead(ctx context.Context, sessionID string) (memoryConversationSnapshot, error) {
	if err := ctx.Err(); err != nil {
		return memoryConversationSnapshot{}, err
	}
	scope, ok := ctx.Value(memoryConversationScopeKey{}).(*memoryConversationScope)
	if !ok {
		return loadMemoryConversation(ctx, sessionID)
	}
	scope.Lock()
	defer scope.Unlock()
	if scope.workspace != util.DataDir {
		return memoryConversationSnapshot{}, errors.New("memory workspace changed")
	}
	if result, exists := scope.sessions[sessionID]; exists {
		return result.snapshot, result.err
	}
	snapshot, err := loadMemoryConversation(ctx, sessionID)
	if len(scope.sessions) < 8 {
		scope.sessions[sessionID] = memoryConversationResult{snapshot, err}
	}
	return snapshot, err
}

func lockMemoryConversation(ctx context.Context, lock *sync.Mutex) error {
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		if lock.TryLock() {
			return nil
		}
		timer := time.NewTimer(5 * time.Millisecond)
		select {
		case <-ctx.Done():
			timer.Stop()
			return ctx.Err()
		case <-timer.C:
		}
	}
}

// 流式读取所需字段并校验整个 JSON，忽略快照等派生字段，防止损坏尾部被当作有效来源。
func decodeMemoryConversation(ctx context.Context, data []byte) (memoryConversationSnapshot, error) {
	ret := memoryConversationSnapshot{entries: map[string]memoryConversationEntry{}}
	dec := json.NewDecoder(bytes.NewReader(data))
	if token, err := dec.Token(); err != nil || token != json.Delim('{') {
		return ret, errors.New("invalid conversation snapshot")
	}
	seen := map[string]bool{}
	for dec.More() {
		if err := ctx.Err(); err != nil {
			return ret, err
		}
		token, err := dec.Token()
		key, ok := token.(string)
		if err != nil || !ok || seen[key] {
			return ret, errors.New("invalid conversation snapshot")
		}
		seen[key] = true
		switch key {
		case "lastCommittedTurnID":
			err = dec.Decode(&ret.committed)
		case "entries":
			if token, e := dec.Token(); e != nil || token != json.Delim('[') {
				return ret, errors.New("invalid conversation entries")
			}
			ids := map[string]bool{}
			for dec.More() {
				if e := ctx.Err(); e != nil {
					return ret, e
				}
				var entry memoryConversationEntry
				if e := dec.Decode(&entry); e != nil {
					return ret, e
				}
				if ids[entry.ID] {
					return ret, errors.New("duplicate conversation entry")
				}
				ids[entry.ID] = true
				if entry.Type == "user" {
					ret.entries[entry.ID] = entry
				}
			}
			_, err = dec.Token()
		default:
			err = skipMemoryJSONValue(ctx, dec, 0)
		}
		if err != nil {
			return ret, err
		}
	}
	if _, err := dec.Token(); err != nil {
		return ret, err
	}
	var extra any
	if err := dec.Decode(&extra); err != io.EOF {
		return ret, errors.New("invalid conversation trailing data")
	}
	return ret, ctx.Err()
}

func skipMemoryJSONValue(ctx context.Context, dec *json.Decoder, depth int) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if depth > 128 {
		return errors.New("conversation nesting exceeds budget")
	}
	token, err := dec.Token()
	if err != nil {
		return err
	}
	if delim, ok := token.(json.Delim); ok {
		if delim != '{' && delim != '[' {
			return errors.New("invalid conversation value")
		}
		for dec.More() {
			if delim == '{' {
				if _, err = dec.Token(); err != nil {
					return err
				}
			}
			if err = skipMemoryJSONValue(ctx, dec, depth+1); err != nil {
				return err
			}
		}
		_, err = dec.Token()
	}
	return err
}
