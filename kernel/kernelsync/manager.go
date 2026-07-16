// SiYuan - Refactor your thinking
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

// Package kernelsync 管理 KernelSyncService 的进程内会话和终态回执。
package kernelsync

import (
	"sync"
	"time"
)

// Terminal 是会话完成后的幂等查询结果。
type Terminal struct {
	Committed  bool
	Generation uint64
	Changes    int
	ExpiresAt  time.Time
}

// Manager 集中管理活动会话及其终态缓存。
type Manager[T any] struct {
	mu       sync.Mutex
	sessions map[string]T
	owners   map[string]string
	terminal map[string]terminalRecord
}

type terminalRecord struct {
	owner string
	Terminal
}

// NewManager 创建空的会话管理器。
func NewManager[T any]() *Manager[T] {
	return &Manager[T]{
		sessions: map[string]T{},
		owners:   map[string]string{},
		terminal: map[string]terminalRecord{},
	}
}

// Add 注册活动会话。
func (manager *Manager[T]) Add(id, owner string, session T) {
	manager.mu.Lock()
	manager.pruneLocked(time.Now())
	manager.sessions[id] = session
	manager.owners[id] = owner
	manager.mu.Unlock()
}

// Lookup 返回属于指定主体的活动会话。
func (manager *Manager[T]) Lookup(id, owner string) (T, bool) {
	manager.mu.Lock()
	session, exists := manager.sessions[id]
	if !exists || manager.owners[id] != owner {
		var zero T
		manager.mu.Unlock()
		return zero, false
	}
	manager.mu.Unlock()
	return session, true
}

// Delete 在实例仍匹配时移除活动会话。
func (manager *Manager[T]) Delete(id string, matches func(T) bool) {
	manager.mu.Lock()
	if session, exists := manager.sessions[id]; exists && (matches == nil || matches(session)) {
		delete(manager.sessions, id)
		delete(manager.owners, id)
	}
	manager.mu.Unlock()
}

// RecordTerminal 保存一小时内可重复查询的终态。
func (manager *Manager[T]) RecordTerminal(id, owner string, terminal Terminal) {
	manager.mu.Lock()
	now := time.Now()
	manager.pruneLocked(now)
	if len(manager.terminal) >= 1024 {
		var oldestID string
		var oldest time.Time
		for candidateID, candidate := range manager.terminal {
			if oldestID == "" || candidate.ExpiresAt.Before(oldest) {
				oldestID, oldest = candidateID, candidate.ExpiresAt
			}
		}
		delete(manager.terminal, oldestID)
	}
	if terminal.ExpiresAt.IsZero() {
		terminal.ExpiresAt = now.Add(time.Hour)
	}
	manager.terminal[id] = terminalRecord{owner: owner, Terminal: terminal}
	manager.mu.Unlock()
}

// LookupTerminal 返回属于指定主体的终态。
func (manager *Manager[T]) LookupTerminal(id, owner string) (Terminal, bool) {
	manager.mu.Lock()
	manager.pruneLocked(time.Now())
	record, exists := manager.terminal[id]
	manager.mu.Unlock()
	if !exists || record.owner != owner {
		return Terminal{}, false
	}
	return record.Terminal, true
}

func (manager *Manager[T]) pruneLocked(now time.Time) {
	for id, terminal := range manager.terminal {
		if !terminal.ExpiresAt.After(now) {
			delete(manager.terminal, id)
		}
	}
}
