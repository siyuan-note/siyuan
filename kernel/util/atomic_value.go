// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package util

import "sync/atomic"

// AtomicValue 发布运行时派生值，读方不会与设置写入竞争。
type AtomicValue[T any] struct{ value atomic.Pointer[T] }

func NewAtomicValue[T any](value T) *AtomicValue[T] {
	ret := &AtomicValue[T]{}
	ret.Store(value)
	return ret
}

func (value *AtomicValue[T]) Load() T {
	if snapshot := value.value.Load(); snapshot != nil {
		return *snapshot
	}
	var zero T
	return zero
}

func (value *AtomicValue[T]) Store(next T) { value.value.Store(&next) }
