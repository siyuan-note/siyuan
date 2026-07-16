// SiYuan - Refactor your thinking
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

package tools

import (
	"context"
	"sync/atomic"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/util"
)

func useImageOperationTestDataDir(t *testing.T) {
	t.Helper()
	original := util.DataDir
	util.DataDir = t.TempDir()
	t.Cleanup(func() { util.DataDir = original })
}

func TestRunImageOperationReusesSuccessfulResult(t *testing.T) {
	useImageOperationTestDataDir(t)
	key := imageOperationKey(map[string]any{"_sessionID": "session", "_toolCallID": "call"}, "generate")
	imageOperations.Delete(key)
	t.Cleanup(func() {
		imageOperations.Delete(key)
		removeImageOperationRecord(key)
	})
	var executions atomic.Int32
	execute := func() CallToolResult {
		executions.Add(1)
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "result"}}}
	}
	meta := imageOperationMeta{Action: "generate", DocumentID: "document"}
	first := runImageOperation(context.Background(), key, meta, execute)
	imageOperations.Delete(key)
	second := runImageOperation(context.Background(), key, meta, execute)
	if executions.Load() != 1 {
		t.Fatalf("successful operation executed %d times", executions.Load())
	}
	if first.Content[0].Text != second.Content[0].Text {
		t.Fatalf("cached result changed: %#v != %#v", first, second)
	}
}

func TestRunImageOperationAllowsRetryAfterError(t *testing.T) {
	useImageOperationTestDataDir(t)
	key := imageOperationKey(map[string]any{"_sessionID": "session", "_toolCallID": "error-call"}, "generate")
	imageOperations.Delete(key)
	t.Cleanup(func() { imageOperations.Delete(key) })
	var executions atomic.Int32
	execute := func() CallToolResult {
		executions.Add(1)
		return imageError("failed")
	}
	meta := imageOperationMeta{Action: "generate", DocumentID: "document"}
	runImageOperation(context.Background(), key, meta, execute)
	runImageOperation(context.Background(), key, meta, execute)
	if executions.Load() != 2 {
		t.Fatalf("failed operation should be retryable, executed %d times", executions.Load())
	}
}

func TestRunImageOperationDoesNotRetryUnknownExecution(t *testing.T) {
	useImageOperationTestDataDir(t)
	key := imageOperationKey(map[string]any{"_sessionID": "session", "_toolCallID": "unknown-call"}, "generate")
	imageOperations.Delete(key)
	t.Cleanup(func() {
		imageOperations.Delete(key)
		removeImageOperationRecord(key)
	})
	var executions atomic.Int32
	meta := imageOperationMeta{Action: "generate", DocumentID: "document"}
	first := runImageOperation(context.Background(), key, meta, func() CallToolResult {
		executions.Add(1)
		return imageUnknown("provider result is unknown")
	})
	imageOperations.Delete(key)
	second := runImageOperation(context.Background(), key, meta, func() CallToolResult {
		executions.Add(1)
		return CallToolResult{}
	})
	if executions.Load() != 1 || !first.ExecutionUnknown || !second.ExecutionUnknown {
		t.Fatalf("unknown external operation was retried: executions=%d first=%#v second=%#v", executions.Load(), first, second)
	}
}

func TestRunImageOperationBlocksUnknownPendingOperation(t *testing.T) {
	useImageOperationTestDataDir(t)
	key := imageOperationKey(map[string]any{"_sessionID": "session", "_toolCallID": "pending-call"}, "generate")
	imageOperations.Delete(key)
	t.Cleanup(func() {
		imageOperations.Delete(key)
		removeImageOperationRecord(key)
	})
	meta := imageOperationMeta{Action: "generate", DocumentID: "document"}
	if err := saveImageOperationRecord(key, meta, imageOperationStateRunning, CallToolResult{}); err != nil {
		t.Fatal(err)
	}
	var executions atomic.Int32
	result := runImageOperation(context.Background(), key, meta, func() CallToolResult {
		executions.Add(1)
		return CallToolResult{}
	})
	if executions.Load() != 0 || !result.IsError || !result.ExecutionUnknown {
		t.Fatalf("pending external operation must not run again: executions=%d result=%#v", executions.Load(), result)
	}
}
