// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package filesys

import (
	"sync"

	"github.com/88250/lute/parse"
)

type treeWriteRecorder struct {
	before []byte
	record func([]byte) error
}

var treeWriteRecorders sync.Map // *parse.Tree -> *treeWriteRecorder

// RecordTreeWrites scopes recovery to this exact tree and writer invocation;
// unrelated saves are never captured by another transaction's recorder.
func RecordTreeWrites(tree *parse.Tree, before []byte, record func([]byte) error, write func() error) error {
	treeWriteRecorders.Store(tree, &treeWriteRecorder{before, record})
	defer treeWriteRecorders.Delete(tree)
	return write()
}

func treeRecorder(tree *parse.Tree) *treeWriteRecorder {
	value, _ := treeWriteRecorders.Load(tree)
	if value == nil {
		return nil
	}
	return value.(*treeWriteRecorder)
}
