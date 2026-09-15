package treenode

import (
	"errors"
	"testing"
	"time"
)

func TestHPathRefreshYieldsToBlockTreeWriter(t *testing.T) {
	indexBlockTreeLock.Lock()
	defer indexBlockTreeLock.Unlock()
	result := make(chan error, 1)
	go func() {
		_, _, err := RefreshBlockHPathsBatch(&BlockTree{}, 0, 32, func() error {
			return errors.New("content write attempted while blocktree writer was busy")
		})
		result <- err
	}()
	select {
	case err := <-result:
		if !errors.Is(err, ErrHPathRefreshBusy) {
			t.Fatalf("background did not yield to writer: %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("background waited for the blocktree writer")
	}
}
