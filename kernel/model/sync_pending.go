package model

import (
	"sync"
	"time"
)

// syncPendingState 合并数据变更通知，并保留同步期间产生的新变更。
type syncPendingState struct {
	mu       sync.Mutex
	revision uint64
	pending  bool
	timer    *time.Timer
}

func (s *syncPendingState) change(notify func(bool)) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.revision++
	s.pending = true
	if s.timer != nil {
		return
	}
	s.timer = time.AfterFunc(100*time.Millisecond, func() {
		s.mu.Lock()
		defer s.mu.Unlock()
		s.timer = nil
		notify(s.pending)
	})
}

func (s *syncPendingState) begin() uint64 {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.revision
}

func (s *syncPendingState) finish(revision uint64, success bool, notify func(bool)) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !success {
		return
	}
	if s.revision == revision {
		s.pending = false
	}
	// 通知与状态修改持有同一把锁，避免旧状态覆盖随后发生的新变更。
	notify(s.pending)
}
