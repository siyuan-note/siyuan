// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package filesys

import (
	"bytes"
	"sync"

	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/util"
)

type treeWriteRecorder struct {
	before []byte
	record func([]byte) error
}

// ObserveTreeWrites 保留外层事务的源记录与比较条件，仅观察本次指定树的写入字节。
func ObserveTreeWrites(tree *parse.Tree, before []byte, observe func([]byte) error, write func() error) error {
	previous := treeRecorder(tree)
	if previous != nil && !bytes.Equal(previous.before, before) {
		return util.ErrFileChanged
	}
	prior, exists := treeWriteObservers.Load(tree)
	var observers []*treeWriteRecorder
	if exists {
		observers = append(observers, prior.([]*treeWriteRecorder)...)
	}
	observers = append(observers, &treeWriteRecorder{before: before, record: observe})
	treeWriteObservers.Store(tree, observers)
	defer func() {
		if exists {
			treeWriteObservers.Store(tree, prior)
		} else {
			treeWriteObservers.Delete(tree)
		}
	}()
	return write()
}

var treeWriteRecorders sync.Map // *parse.Tree -> *treeWriteRecorder
var treeWriteObservers sync.Map // *parse.Tree -> []*treeWriteRecorder

// RecordTreeWrites scopes recovery to this exact tree and writer invocation;
// unrelated saves are never captured by another transaction's recorder.
func RecordTreeWrites(tree *parse.Tree, before []byte, record func([]byte) error, write func() error) error {
	prior, exists := treeWriteRecorders.Load(tree)
	if exists {
		previous := prior.(*treeWriteRecorder)
		if !bytes.Equal(previous.before, before) {
			return util.ErrFileChanged
		}
		current := record
		record = func(data []byte) error {
			if err := previous.record(data); err != nil {
				return err
			}
			return current(data)
		}
	}
	treeWriteRecorders.Store(tree, &treeWriteRecorder{before, record})
	defer func() {
		if exists {
			treeWriteRecorders.Store(tree, prior)
		} else {
			treeWriteRecorders.Delete(tree)
		}
	}()
	return write()
}

func treeRecorder(tree *parse.Tree) *treeWriteRecorder {
	value, _ := treeWriteRecorders.Load(tree)
	var base *treeWriteRecorder
	if value != nil {
		base = value.(*treeWriteRecorder)
	}
	active, exists := treeWriteObservers.Load(tree)
	if !exists {
		return base
	}
	observers := active.([]*treeWriteRecorder)
	before := observers[0].before
	if base != nil {
		before = base.before
	}
	return &treeWriteRecorder{before: before, record: func(data []byte) error {
		for _, observer := range observers {
			if !bytes.Equal(before, observer.before) {
				return util.ErrFileChanged
			}
		}
		if base != nil {
			if err := base.record(data); err != nil {
				return err
			}
		}
		for _, observer := range observers {
			if err := observer.record(data); err != nil {
				return err
			}
		}
		return nil
	}}
}
