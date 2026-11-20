// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"net/http/httptest"
	"strconv"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

type broadcastLifecycleWriter struct {
	*httptest.ResponseRecorder
	gone chan bool
}

func (writer *broadcastLifecycleWriter) CloseNotify() <-chan bool { return writer.gone }

func broadcastLifecycleWait[T any](t *testing.T, result <-chan T) T {
	t.Helper()
	select {
	case value := <-result:
		return value
	case <-time.After(5 * time.Second):
		t.Fatal("broadcast lifecycle blocked")
		var zero T
		return zero
	}
}

func TestEventSourceStreamCloseOrder(t *testing.T) {
	for _, first := range []int{0, 1} {
		for _, clientClose := range []bool{false, true} {
			t.Run(strconv.Itoa(first)+"/client="+strconv.FormatBool(clientClose), func(t *testing.T) {
				server := &EventSourceServer{}
				var writers [2]*broadcastLifecycleWriter
				var finished [2]chan bool
				var received [2]chan string
				for i := range writers {
					writers[i] = &broadcastLifecycleWriter{httptest.NewRecorder(), make(chan bool, 1)}
					finished[i], received[i] = make(chan bool, 1), make(chan string, 4)
					c, _ := gin.CreateTestContext(writers[i])
					go func() {
						finished[i] <- server.Stream(c, func(event *MessageEvent, ok bool) bool {
							if event.Type == MessageTypeClose {
								return event.Name != strconv.Itoa(i)
							}
							received[i] <- event.ID
							return ok
						})
						close(finished[i])
					}()
					t.Cleanup(func() {
						close(writers[i].gone)
						broadcastLifecycleWait(t, finished[i])
					})
					broadcastTestWait(t, func() bool {
						server.streamsLock.Lock()
						defer server.streamsLock.Unlock()
						return len(server.streams) == i+1
					})
				}
				publish := func(event *MessageEvent) bool {
					result := make(chan bool, 1)
					go func() { result <- server.SendEvent(event) }()
					return broadcastLifecycleWait(t, result)
				}
				if !publish(&MessageEvent{ID: "before"}) {
					t.Fatal("missing subscribers")
				}
				for _, events := range received {
					if broadcastLifecycleWait(t, events) != "before" {
						t.Fatal("initial event lost")
					}
				}
				if clientClose {
					writers[first].gone <- true
				} else {
					publish(&MessageEvent{Type: MessageTypeClose, Name: strconv.Itoa(first)})
				}
				if broadcastLifecycleWait(t, finished[first]) != clientClose {
					t.Fatal("wrong close reason")
				}
				if !publish(&MessageEvent{ID: "after"}) || broadcastLifecycleWait(t, received[1-first]) != "after" {
					t.Fatal("closing one stream removed the other subscriber")
				}
				writers[1-first].gone <- true
				broadcastLifecycleWait(t, finished[1-first])
				if publish(&MessageEvent{ID: "closed"}) {
					t.Fatal("closed subscriptions remain registered")
				}
			})
		}
	}
}

func TestEventSourceStreamCancellationReleasesPublisher(t *testing.T) {
	stream := &eventSourceStream{messages: make(MessageEventChannel), done: make(chan struct{})}
	finished := make(chan struct{})
	go func() {
		stream.send(&MessageEvent{ID: "pending"})
		close(finished)
	}()
	close(stream.done)
	broadcastLifecycleWait(t, finished)
	finished = make(chan struct{})
	go func() {
		stream.send(&MessageEvent{ID: "stale snapshot"})
		close(finished)
	}()
	broadcastLifecycleWait(t, finished)
}
