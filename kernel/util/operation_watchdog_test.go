package util

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestOperationWatchdogCapturesBlockedStage(t *testing.T) {
	reported := make(chan operationStall, 1)
	w := watchOperation("delete", "start", 20*time.Millisecond, func(stall operationStall) { reported <- stall })
	defer w.Finish()
	w.Stage("waiting for index")
	select {
	case stall := <-reported:
		if stall.name != "delete" || stall.stage != "waiting for index" || stall.elapsed < 20*time.Millisecond {
			t.Fatalf("unexpected diagnostic: %+v", stall)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("blocked operation was not reported before completion")
	}
}

func TestOperationWatchdogStopsAfterCompletion(t *testing.T) {
	reported := make(chan operationStall, 1)
	w := watchOperation("delete", "start", 20*time.Millisecond, func(stall operationStall) { reported <- stall })
	w.Finish()
	select {
	case <-reported:
		t.Fatal("completed operation was reported as blocked")
	case <-time.After(50 * time.Millisecond):
	}
}

func TestOperationStallSnapshotIsBoundedAndRateLimited(t *testing.T) {
	dir := t.TempDir()
	r := &stallRecorder{}
	r.record(dir, operationStall{"delete", "index", 10 * time.Second})
	path := filepath.Join(dir, OperationStallLogName)
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"operation: delete", "stage: index", "goroutine ", "TestOperationStallSnapshot"} {
		if !strings.Contains(string(data), want) {
			t.Fatalf("missing %q", want)
		}
	}
	if len(data) > 8*1024*1024+1024 {
		t.Fatal("snapshot exceeds size limit")
	}
	r.record(dir, operationStall{"second", "index", 10 * time.Second})
	again, err := os.ReadFile(path)
	if err != nil || string(data) != string(again) {
		t.Fatal("rate limit did not preserve first snapshot")
	}
	r.last = time.Now().Add(-2 * time.Minute)
	r.record(dir, operationStall{"third", "index", 10 * time.Second})
	again, err = os.ReadFile(path)
	if err != nil || !strings.Contains(string(again), "operation: third") {
		t.Fatal("snapshot was not replaced after rate limit expired")
	}
	files, err := os.ReadDir(dir)
	if err != nil || len(files) != 1 {
		t.Fatal("temporary diagnostic files remain")
	}
}
