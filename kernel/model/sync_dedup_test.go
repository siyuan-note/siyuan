// SiYuan - From thought to insight, with agents
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

package model

import (
	"errors"
	"sync/atomic"
	"testing"
	"time"
)

func TestSyncRemoteDeduperCoalescesConcurrentRequests(t *testing.T) {
	deduper := newSyncRemoteDeduper(time.Minute)
	started := make(chan struct{})
	release := make(chan struct{})
	firstDone := make(chan error, 1)
	secondDone := make(chan error, 1)
	var firstRuns, secondRuns atomic.Int32

	go func() {
		_, err := deduper.do("scope", "latest", func() error {
			firstRuns.Add(1)
			close(started)
			<-release
			return nil
		})
		firstDone <- err
	}()
	<-started
	go func() {
		_, err := deduper.do("scope", "latest", func() error {
			secondRuns.Add(1)
			return nil
		})
		secondDone <- err
	}()
	close(release)

	if err := <-firstDone; nil != err {
		t.Fatalf("first request failed: %s", err)
	}
	if err := <-secondDone; nil != err {
		t.Fatalf("second request failed: %s", err)
	}
	if 1 != firstRuns.Load() || 0 != secondRuns.Load() {
		t.Fatalf("unexpected action counts [first=%d, second=%d]", firstRuns.Load(), secondRuns.Load())
	}
}

func TestSyncRemoteDeduperRetriesAfterFailure(t *testing.T) {
	deduper := newSyncRemoteDeduper(time.Minute)
	expected := errors.New("sync failed")
	executed, err := deduper.do("scope", "latest", func() error {
		return expected
	})
	if !executed || !errors.Is(err, expected) {
		t.Fatalf("unexpected first result [executed=%t, err=%v]", executed, err)
	}

	executed, err = deduper.do("scope", "latest", func() error {
		return nil
	})
	if !executed || nil != err {
		t.Fatalf("unexpected retry result [executed=%t, err=%v]", executed, err)
	}
}

func TestSyncRemoteDeduperSeparatesScopeAndLatest(t *testing.T) {
	deduper := newSyncRemoteDeduper(time.Minute)
	var runs atomic.Int32
	action := func() error {
		runs.Add(1)
		return nil
	}

	for _, request := range []syncRemoteKey{
		{scope: "scope-a", latestID: "latest-a"},
		{scope: "scope-a", latestID: "latest-b"},
		{scope: "scope-b", latestID: "latest-a"},
	} {
		executed, err := deduper.do(request.scope, request.latestID, action)
		if !executed || nil != err {
			t.Fatalf("unexpected result for [%+v] [executed=%t, err=%v]", request, executed, err)
		}
	}
	if 3 != runs.Load() {
		t.Fatalf("unexpected action count [%d]", runs.Load())
	}
}

func TestSyncRemoteDeduperExpiresCompletedRequest(t *testing.T) {
	deduper := newSyncRemoteDeduper(time.Minute)
	now := time.Unix(100, 0)
	deduper.now = func() time.Time {
		return now
	}
	var runs atomic.Int32
	action := func() error {
		runs.Add(1)
		return nil
	}

	if executed, err := deduper.do("scope", "latest", action); !executed || nil != err {
		t.Fatalf("unexpected first result [executed=%t, err=%v]", executed, err)
	}
	if executed, err := deduper.do("scope", "latest", action); executed || nil != err {
		t.Fatalf("unexpected cached result [executed=%t, err=%v]", executed, err)
	}
	now = now.Add(time.Minute)
	if executed, err := deduper.do("scope", "latest", action); !executed || nil != err {
		t.Fatalf("unexpected expired result [executed=%t, err=%v]", executed, err)
	}
	if 2 != runs.Load() {
		t.Fatalf("unexpected action count [%d]", runs.Load())
	}
}

func TestSyncRemoteDeduperCompletesActualLatest(t *testing.T) {
	deduper := newSyncRemoteDeduper(time.Minute)
	executed, err := deduper.do("scope", "hinted-latest", func() error {
		deduper.complete("scope", "actual-latest")
		return nil
	})
	if !executed || nil != err {
		t.Fatalf("unexpected hinted result [executed=%t, err=%v]", executed, err)
	}

	executed, err = deduper.do("scope", "actual-latest", func() error {
		return nil
	})
	if executed || nil != err {
		t.Fatalf("unexpected actual result [executed=%t, err=%v]", executed, err)
	}
}

func TestSyncRemoteDeduperReleasesRequestAfterPanic(t *testing.T) {
	deduper := newSyncRemoteDeduper(time.Minute)
	func() {
		defer func() {
			_ = recover()
		}()
		_, _ = deduper.do("scope", "latest", func() error {
			panic("sync panic")
		})
	}()

	executed, err := deduper.do("scope", "latest", func() error {
		return nil
	})
	if !executed || nil != err {
		t.Fatalf("unexpected result after panic [executed=%t, err=%v]", executed, err)
	}
}
