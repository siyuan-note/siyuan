// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"context"
	"errors"
	"sync"

	"github.com/siyuan-note/siyuan/kernel/memory"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// ErrAIMemorySourceMissing 仅表示已确认删除的来源，读取故障必须保留原始错误。
var ErrAIMemorySourceMissing = errors.New("memory source no longer exists")

// AIMemoryConversationReadScope 由会话模块注册，同轮复核共享只读会话快照。
var AIMemoryConversationReadScope func(context.Context) context.Context

type memoryReadKey struct{}
type memorySourceRead struct {
	source memory.Source
	err    error
}
type memoryReadScope struct {
	sync.Mutex
	workspace string
	sources   map[string]memorySourceRead
	bytes     int
}

// 每个校验阶段使用独立作用域，模型调用和写入前后不能共享旧快照。
func newMemoryReadScope(ctx context.Context) context.Context {
	if AIMemoryConversationReadScope != nil {
		ctx = AIMemoryConversationReadScope(ctx)
	}
	return context.WithValue(ctx, memoryReadKey{}, &memoryReadScope{workspace: util.DataDir, sources: map[string]memorySourceRead{}})
}

func memorySourceSnapshot(ctx context.Context, id string) (memory.Source, error) {
	if err := ctx.Err(); err != nil {
		return memory.Source{}, err
	}
	scope, ok := ctx.Value(memoryReadKey{}).(*memoryReadScope)
	if !ok {
		return readMemorySourceSnapshot(ctx, id)
	}
	scope.Lock()
	defer scope.Unlock()
	if scope.workspace != util.DataDir {
		return memory.Source{}, errors.New("memory workspace changed")
	}
	if value, exists := scope.sources[id]; exists {
		return value.source, value.err
	}
	source, err := readMemorySourceSnapshot(ctx, id)
	if len(scope.sources) < 128 && scope.bytes+len(source.Evidence) <= 2*1024*1024 {
		scope.sources[id] = memorySourceRead{source, err}
		scope.bytes += len(source.Evidence)
	}
	return source, err
}

func memoryRecordAffected(record memory.Record, changedIDs []string) bool {
	if len(changedIDs) == 0 {
		return true
	}
	changed := map[string]bool{}
	for _, id := range changedIDs {
		changed[id] = true
	}
	for _, source := range record.Sources {
		if changed[source.ID] {
			return true
		}
		if source.Kind == "block" {
			// 已删除子块没有索引映射，仍需检查；完好的其他文档不参与本轮复核。
			bt := treenode.GetBlockTree(source.ID)
			if bt == nil || changed[bt.RootID] {
				return true
			}
		}
	}
	return false
}
