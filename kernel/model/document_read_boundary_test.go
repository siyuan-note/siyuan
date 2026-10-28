// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"sync"
	"testing"
	"time"
)

func TestDocumentReadBoundarySharesReadsAndExcludesWrites(t *testing.T) {
	FlushTxQueue()
	entered := make(chan struct{}, 2)
	resume := make(chan struct{})
	var release sync.Once
	defer release.Do(func() { close(resume) })
	var readers sync.WaitGroup
	for range 2 {
		readers.Go(func() {
			readAtTransactionBoundary(func() { entered <- struct{}{}; <-resume }, nil)
		})
	}
	for range 2 {
		select {
		case <-entered:
		case <-time.After(5 * time.Second):
			t.Fatal("empty-queue document reads did not share the read boundary")
		}
	}
	writer := make(chan struct{})
	go func() { flushLock.Lock(); flushLock.Unlock(); close(writer) }()
	select {
	case <-writer:
		t.Fatal("writer entered while a source snapshot was still being loaded")
	case <-time.After(20 * time.Millisecond):
	}
	release.Do(func() { close(resume) })
	readers.Wait()
	requireTransactionFinished(t, writer)
}

func TestDocumentReadBoundaryFinishesCapturedBatchAndLeavesLaterTransactions(t *testing.T) {
	FlushTxQueue()
	first, second, later := &Transaction{Timestamp: 1}, &Transaction{Timestamp: 2}, &Transaction{Timestamp: 3}
	flushLock.Lock()
	initial := []*Transaction{second, first}
	PerformTransactions(&initial)
	readDone := make(chan struct{})
	observed := make(chan bool, 1)
	go func() {
		readAtTransactionBoundary(func() {
			finished := func(tx *Transaction) bool {
				select {
				case <-tx.completion.Load().done:
					return true
				default:
					return false
				}
			}
			next := []*Transaction{later}
			PerformTransactions(&next)
			observed <- finished(first) && finished(second) && !finished(later)
		}, nil)
		close(readDone)
	}()
	flushLock.Unlock()
	requireTransactionFinished(t, readDone)
	if !<-observed {
		t.Fatal("source capture missed its completed batch or executed a later arrival")
	}
	FlushTxQueue()
}

func TestDocumentReadBoundaryReleasesLockAfterReadPanic(t *testing.T) {
	FlushTxQueue()
	func() {
		defer func() {
			if recover() == nil {
				t.Error("read panic was unexpectedly swallowed")
			}
		}()
		readAtTransactionBoundary(func() { panic("injected snapshot read failure") }, nil)
	}()
	if !flushLock.TryLock() {
		t.Fatal("failed source capture retained the transaction lock")
	}
	flushLock.Unlock()
}

func BenchmarkDocumentReadBoundaryEmpty(b *testing.B) {
	FlushTxQueue()
	b.ReportAllocs()
	for b.Loop() {
		readAtTransactionBoundary(func() {}, nil)
	}
}
