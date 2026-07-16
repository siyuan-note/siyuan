// SiYuan - Refactor your thinking
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package synccommit

import (
	"errors"
	"fmt"
	"sync/atomic"
	"time"
)

type ErrorKind uint8

const (
	ErrorInternal ErrorKind = iota
	ErrorInvalid
	ErrorForbidden
	ErrorConflict
	ErrorLocked
)

type Error struct {
	Kind    ErrorKind
	Decided bool
	Err     error
}

func (err *Error) Error() string { return err.Err.Error() }
func (err *Error) Unwrap() error { return err.Err }

func wrapError(kind ErrorKind, decided bool, err error) error {
	if err == nil {
		return nil
	}
	var commitErr *Error
	if errors.As(err, &commitErr) {
		if decided {
			commitErr.Decided = true
		}
		return commitErr
	}
	return &Error{Kind: kind, Decided: decided, Err: err}
}

func ErrorInfo(err error) (ErrorKind, bool) {
	var commitErr *Error
	if errors.As(err, &commitErr) {
		return commitErr.Kind, commitErr.Decided
	}
	return ErrorInternal, false
}

type Operation string

const (
	OperationWrite  Operation = "write"
	OperationDelete Operation = "delete"
)

type Change struct {
	Operation   Operation
	Path        string
	StagePath   string
	Size        int64
	Hash        string
	ModTime     time.Time
	IfMatch     string
	IfNoneMatch bool
}

type CommitRequest struct {
	SessionID          string
	Owner              string
	ExpectedGeneration uint64
	Changes            []Change
	EnterCritical      func() bool
}

type Receipt struct {
	Version     int       `json:"version"`
	SessionID   string    `json:"sessionId"`
	Owner       string    `json:"owner"`
	Generation  uint64    `json:"generation"`
	Changes     int       `json:"changes"`
	CommittedAt time.Time `json:"committedAt"`
}

type Result struct {
	Receipt        Receipt
	Decided        bool
	Resumed        bool
	CleanupPending bool
}

type Plan struct {
	request   CommitRequest
	execution *execution
	closed    atomic.Bool
}

func (plan *Plan) Close() {
	if plan == nil || !plan.closed.CompareAndSwap(false, true) || plan.execution == nil {
		return
	}
	_ = plan.execution.cleanupArtifacts()
	plan.execution.close()
	plan.execution = nil
}

type Options struct {
	Reload    func()
	Advance   func() uint64
	FaultHook func(point string, index int) error
}

type Engine struct {
	options Options
}

func NewEngine(options Options) *Engine {
	if options.Reload == nil {
		options.Reload = func() {}
	}
	if options.Advance == nil {
		options.Advance = func() uint64 { return 0 }
	}
	return &Engine{options: options}
}

func (engine *Engine) inject(point string, index int) error {
	if engine == nil || engine.options.FaultHook == nil {
		return nil
	}
	if err := engine.options.FaultHook(point, index); err != nil {
		return fmt.Errorf("fault at %s[%d]: %w", point, index, err)
	}
	return nil
}
