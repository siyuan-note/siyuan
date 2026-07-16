// SiYuan - Refactor your thinking
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"container/heap"
	"fmt"
	"sync/atomic"
	"testing"
	"time"
)

func TestKernelSyncScanFrameHeapOrdersLargeSiblingSet(t *testing.T) {
	const count = 50_000
	frames := &kernelSyncScanFrameHeap{}
	heap.Init(frames)
	for index := count - 1; index >= 0; index-- {
		heap.Push(frames, kernelSyncScanFrame{path: fmt.Sprintf("/data/%05d", index)})
	}
	for index := 0; index < count; index++ {
		frame := heap.Pop(frames).(kernelSyncScanFrame)
		expected := fmt.Sprintf("/data/%05d", index)
		if frame.path != expected {
			t.Fatalf("frame %d: got %q, want %q", index, frame.path, expected)
		}
	}
}

func TestKernelSyncManifestHashPipelineIsBoundedAndOrdered(t *testing.T) {
	previousHash := kernelSyncHashCandidate
	defer func() { kernelSyncHashCandidate = previousHash }()
	var active atomic.Int32
	var maximum atomic.Int32
	kernelSyncHashCandidate = func(candidate kernelSyncScanCandidate) (kernelSyncManifestEntry, error) {
		current := active.Add(1)
		for {
			observed := maximum.Load()
			if current <= observed || maximum.CompareAndSwap(observed, current) {
				break
			}
		}
		time.Sleep(2 * time.Millisecond)
		active.Add(-1)
		return kernelSyncManifestEntry{Path: candidate.path}, nil
	}
	candidates := make([]kernelSyncScanCandidate, 64)
	for index := range candidates {
		candidates[index].path = fmt.Sprintf("/data/%03d", index)
	}
	entries, err := hashKernelSyncManifestCandidates(candidates)
	if err != nil {
		t.Fatal(err)
	}
	if maximum.Load() < 1 || maximum.Load() > 8 {
		t.Fatalf("unexpected hash concurrency: %d", maximum.Load())
	}
	for index, entry := range entries {
		if entry.Path != candidates[index].path {
			t.Fatalf("entry order changed at %d: %s", index, entry.Path)
		}
	}
}

func TestKernelSyncGlobMatcherUsesLiteralPrefixIndex(t *testing.T) {
	matcher, err := newKernelSyncGlobMatcher(
		[]string{"assets/icons/logo-*.png", "docs/**"},
		[]string{"assets/icons/logo-private*", "docs/private/**"},
	)
	if err != nil {
		t.Fatal(err)
	}
	if !matcher.matches("assets/icons/logo-main.png") || !matcher.matches("docs/readme.md") {
		t.Fatal("prefix-indexed includes did not match")
	}
	if matcher.matches("assets/icons/logo-private.png") || matcher.matches("docs/private/secret.md") ||
		matcher.matches("assets/other/logo-main.png") {
		t.Fatal("prefix-indexed matcher accepted an excluded or unrelated path")
	}
	if !matcher.descend("assets") || !matcher.descend("assets/icons") || matcher.descend("unrelated") {
		t.Fatal("prefix-indexed matcher selected an incorrect traversal scope")
	}
	fallback, err := newKernelSyncGlobMatcher([]string{"*.json"}, nil)
	if err != nil || !fallback.matches("root.json") || fallback.matches("nested/root.json") {
		t.Fatal("wildcard fallback index changed glob semantics")
	}
}
