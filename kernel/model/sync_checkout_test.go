package model

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/siyuan-note/dejavu/entity"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestSyncCheckoutSpaceAndProgress(t *testing.T) {
	previousDisk, previousConf, previousLangs := checkoutDiskUsage, Conf, util.Langs
	t.Cleanup(func() { checkoutDiskUsage = previousDisk; Conf = previousConf; util.Langs = previousLangs })
	Conf = &AppConf{Lang: "en"}
	util.Langs = map[string]map[int]string{"en": {434: "required %s, available %s", 433: "canceled"}}
	checkoutDiskUsage = func(string) (uint64, uint64, uint64) { return 100, 90, 10 }
	if err := checkCheckoutSpace([]*entity.File{{Size: 11}}); err == nil {
		t.Fatal("insufficient space accepted")
	}
	if err := checkCheckoutSpace([]*entity.File{{Size: 10}, {Size: 9}}); err != nil {
		t.Fatal("sequential temporary files were incorrectly added together", err)
	}
	checkoutDiskUsage = func(string) (uint64, uint64, uint64) { return 0, 0, 0 }
	if err := checkCheckoutSpace([]*entity.File{{Size: 1000}}); err != nil {
		t.Fatal("unknown disk usage treated as zero free space")
	}
	for _, total := range []int{1, 9, 10, 11, 31, 60, 1000} {
		var got int32
		for count := 1; count <= total; count++ {
			got += repoBootIncrement(count, total)
		}
		if got != 10 {
			t.Fatalf("%d files only advanced %d", total, got)
		}
	}
	if repoBootIncrement(0, 0) != 0 || repoBootIncrement(0, 60) != 0 {
		t.Fatal("invalid progress advanced boot")
	}
	if formatCheckoutDuration(3661*time.Second) != "01:01:01" {
		t.Fatal("invalid remaining time")
	}
	if got := formatSyncRepoErrorMsg(fmt.Errorf("wrapped: %w", context.Canceled)); got != "canceled" {
		t.Fatal(got)
	}
}

func TestSyncCheckoutCancellationIdentity(t *testing.T) {
	activeSyncCheckout.Lock()
	previous := activeSyncCheckout.task
	activeSyncCheckout.Unlock()
	t.Cleanup(func() { activeSyncCheckout.Lock(); activeSyncCheckout.task = previous; activeSyncCheckout.Unlock() })
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	activeSyncCheckout.Lock()
	activeSyncCheckout.task = &syncCheckoutTask{id: "current", cancel: cancel}
	activeSyncCheckout.Unlock()
	if CancelSyncCheckout("stale") || ctx.Err() != nil {
		t.Fatal("old task canceled current sync")
	}
	if !CancelSyncCheckout("current") || !errors.Is(ctx.Err(), context.Canceled) {
		t.Fatal("current task was not canceled")
	}
	activeSyncCheckout.Lock()
	activeSyncCheckout.task = nil
	activeSyncCheckout.Unlock()
	if CancelSyncCheckout("current") {
		t.Fatal("completed task was canceled")
	}
}
