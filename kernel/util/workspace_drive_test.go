package util

import (
	"context"
	"sync"
	"testing"
	"testing/synctest"
	"time"
)

func TestWorkspaceDriveCache(t *testing.T) {
	for _, value := range []string{"SSD", ""} {
		t.Run(value, func(t *testing.T) {
			cache := workspaceDriveTypeCache{done: make(chan struct{})}
			calls := 0
			detect := func() string { calls++; return value }
			var callers sync.WaitGroup
			for range 10 {
				callers.Go(func() {
					if got := cache.get(context.Background(), detect); got != value {
						t.Errorf("got %q, want %q", got, value)
					}
				})
			}
			callers.Wait()
			if calls != 1 {
				t.Fatalf("detection ran %d times", calls)
			}
		})
	}
}

func TestWorkspaceDriveCacheCancellation(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		cache := workspaceDriveTypeCache{done: make(chan struct{})}
		release := make(chan struct{})
		calls := 0
		detect := func() string { calls++; <-release; return "HDD" }
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		if got := cache.get(ctx, detect); got != "" || ctx.Err() != context.DeadlineExceeded {
			t.Fatalf("slow query did not time out: %q, %v", got, ctx.Err())
		}
		canceled, stop := context.WithCancel(context.Background())
		stop()
		if got := cache.get(canceled, detect); got != "" {
			t.Fatalf("canceled caller returned %q", got)
		}
		close(release)
		if got := cache.get(context.Background(), detect); got != "HDD" || calls != 1 {
			t.Fatalf("query result was not reused: %q, calls=%d", got, calls)
		}
	})
}
