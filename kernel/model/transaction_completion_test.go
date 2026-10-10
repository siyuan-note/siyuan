package model

import (
	"testing"
	"time"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
)

func waitForTransactionInTest(tx *Transaction) <-chan struct{} {
	done := make(chan struct{})
	go func() {
		tx.WaitForCommit()
		close(done)
	}()
	return done
}

func requireTransactionWaiting(t *testing.T, done <-chan struct{}) {
	t.Helper()
	select {
	case <-done:
		t.Fatal("transaction wait returned before execution finished")
	case <-time.After(20 * time.Millisecond):
	}
}

func requireTransactionFinished(t *testing.T, done <-chan struct{}) {
	t.Helper()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("transaction wait did not return after execution finished")
	}
}

func TestQueuedTransactionWaitForCommit(t *testing.T) {
	FlushTxQueue()
	flushLock.Lock()
	defer func() {
		for _, tx := range takeQueuedTransactions() {
			flushTx(tx)
		}
		flushLock.Unlock()
	}()
	first := &Transaction{Timestamp: 1}
	second := &Transaction{Timestamp: 2}
	transactions := []*Transaction{second, first}
	PerformTransactions(&transactions)
	firstWaiters := []<-chan struct{}{waitForTransactionInTest(first), waitForTransactionInTest(first)}
	secondWaiter := waitForTransactionInTest(second)
	for _, done := range firstWaiters {
		requireTransactionWaiting(t, done)
	}
	requireTransactionWaiting(t, secondWaiter)
	queued := takeQueuedTransactions()
	if len(queued) != 2 || queued[0] != first || queued[1] != second {
		t.Fatalf("transaction timestamp order changed: %v", queued)
	}
	// 队列已取走但仍未执行时，完成等待必须继续阻塞。
	requireTransactionWaiting(t, firstWaiters[0])
	flushTx(first)
	for _, done := range firstWaiters {
		requireTransactionFinished(t, done)
	}
	requireTransactionWaiting(t, secondWaiter)
	flushTx(second)
	requireTransactionFinished(t, secondWaiter)
	requireTransactionFinished(t, waitForTransactionInTest(first))
}

func TestFlushTxQueueWaitsForDequeuedTransaction(t *testing.T) {
	FlushTxQueue()
	flushLock.Lock()
	isFlushing.Store(true)
	defer func() {
		isFlushing.Store(false)
		flushLock.Unlock()
	}()
	tx := &Transaction{}
	transactions := []*Transaction{tx}
	PerformTransactions(&transactions)
	queued := takeQueuedTransactions()
	if len(queued) != 1 || queued[0] != tx {
		t.Fatal("transaction was not queued")
	}
	done := make(chan struct{})
	go func() { FlushTxQueue(); close(done) }()
	requireTransactionWaiting(t, done)
	flushTx(tx)
	requireTransactionWaiting(t, done)
	isFlushing.Store(false)
	requireTransactionFinished(t, done)
	if completion := tx.completion.Load(); completion == nil {
		t.Fatal("transaction completion was not registered")
	} else {
		select {
		case <-completion.done:
		default:
			t.Fatal("queue flush returned before commit completion")
		}
	}
}

func BenchmarkFlushTxQueueEmpty(b *testing.B) {
	FlushTxQueue()
	flushLock.Lock()
	b.Cleanup(flushLock.Unlock)
	for b.Loop() {
		FlushTxQueue()
	}
}

func TestWaitForSubmittedTransactionBatch(t *testing.T) {
	FlushTxQueue()
	flushLock.Lock()
	defer func() {
		for _, tx := range takeQueuedTransactions() {
			flushTx(tx)
		}
		flushLock.Unlock()
	}()
	first, second := &Transaction{Timestamp: 1}, &Transaction{Timestamp: 2}
	transactions := []*Transaction{second, first}
	PerformTransactions(&transactions)
	done := make(chan struct{})
	go func() { WaitForTransactions(transactions); close(done) }()
	requireTransactionWaiting(t, done)
	queued := takeQueuedTransactions()
	defer func() {
		for _, tx := range queued {
			flushTx(tx)
		}
	}()
	flushTx(queued[0])
	queued = queued[1:]
	requireTransactionWaiting(t, done)
	flushTx(queued[0])
	queued = nil
	requireTransactionFinished(t, done)

	// 后续事务尚未执行时，已完成批次和空批次仍能返回。
	later := []*Transaction{{Timestamp: 3}}
	PerformTransactions(&later)
	completed, empty := make(chan struct{}), make(chan struct{})
	go func() { WaitForTransactions(transactions); close(completed) }()
	go func() { WaitForTransactions(nil); close(empty) }()
	requireTransactionFinished(t, completed)
	requireTransactionFinished(t, empty)
	requireTransactionWaiting(t, waitForTransactionInTest(later[0]))
}

func TestTransactionCompletionOnAllExecutionExits(t *testing.T) {
	fixture := setupStructureTransactionTest(t)
	for _, mode := range []string{"sync", "queue", "sync-notify"} {
		for _, kind := range []string{"empty", "invalid", "panic", "begin-error"} {
			t.Run(mode+"/"+kind, func(t *testing.T) {
				tx := &Transaction{}
				switch kind {
				case "invalid":
					tx.DoOperations = []*Operation{{Action: "update", ID: fixture.childID, Data: 1}}
				case "panic":
					tx.DoOperations = []*Operation{nil}
				case "begin-error":
					tx.templateDocTreeRootSnapshot = &parse.Tree{ID: "different-parent"}
					tx.DoOperations = []*Operation{{Action: "restoreCreatedDoc", templateDocTreeRootID: fixture.sourceID,
						Tree: &parse.Tree{Box: fixture.box.ID, Root: &ast.Node{ID: "created"}}}}
				}
				if mode != "queue" {
					run := PerformTxSync
					if mode == "sync-notify" {
						run = PerformTransactionSync
					}
					err := run(tx)
					if (err == nil) != (kind == "empty" || (kind == "panic" && mode == "sync")) {
						t.Fatalf("unexpected %s result: %v", kind, err)
					}
				} else {
					transactions := []*Transaction{tx}
					PerformTransactions(&transactions)
				}
				requireTransactionFinished(t, waitForTransactionInTest(tx))
				if state := tx.state.Load(); state == 1 {
					t.Fatal("transaction wait returned while a transaction remained active")
				}
			})
		}
	}
}

func TestTransactionCompletionRepeatedSyncExecution(t *testing.T) {
	tx := &Transaction{}
	for i := 0; i < 2; i++ {
		if err := PerformTxSync(tx); err != nil {
			t.Fatal(err)
		}
		requireTransactionFinished(t, waitForTransactionInTest(tx))
	}
}

func TestTransactionCompletionWaitsForSyncExecution(t *testing.T) {
	for _, run := range []func(*Transaction) error{PerformTxSync, PerformTransactionSync} {
		tx := &Transaction{}
		flushLock.Lock()
		unlocked := false
		func() {
			defer func() {
				if !unlocked {
					flushLock.Unlock()
				}
			}()
			result := make(chan error, 1)
			go func() { result <- run(tx) }()
			deadline := time.Now().Add(5 * time.Second)
			for tx.completion.Load() == nil {
				if time.Now().After(deadline) {
					t.Fatal("synchronous transaction did not register its pending completion")
				}
				time.Sleep(time.Millisecond)
			}
			waiter := waitForTransactionInTest(tx)
			requireTransactionWaiting(t, waiter)
			flushLock.Unlock()
			unlocked = true
			requireTransactionFinished(t, waiter)
			if err := <-result; err != nil {
				t.Fatal(err)
			}
		}()
	}
}
