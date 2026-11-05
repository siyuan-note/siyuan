// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/agent"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
)

type agentDeadlineWriter struct {
	*httptest.ResponseRecorder
	deadlines          []time.Time
	flushErr           error
	flushes            int
	blockUntilDeadline bool
}

func (w *agentDeadlineWriter) SetWriteDeadline(deadline time.Time) error {
	w.deadlines = append(w.deadlines, deadline)
	return nil
}

func (w *agentDeadlineWriter) FlushError() error {
	w.flushes++
	if w.blockUntilDeadline {
		if len(w.deadlines) == 0 || w.deadlines[len(w.deadlines)-1].IsZero() {
			return errors.New("blocking flush did not receive a deadline")
		}
		<-time.After(time.Until(w.deadlines[len(w.deadlines)-1]))
		return os.ErrDeadlineExceeded
	}
	return w.flushErr
}

func TestAPIContractAgentSSEDelivery(t *testing.T) {
	bundle, err := apicontract.BuildBundle()
	if err != nil {
		t.Fatal(err)
	}
	for _, event := range []agent.AgentEvent{
		{Type: "thinking", Reasoning: "compacting context", RoundID: "same-round"},
		{Type: "interrupted", Error: "consumer stalled"},
		{Type: "usage", PromptTokens: 10, CompletionTokens: 3},
	} {
		writer := &agentDeadlineWriter{ResponseRecorder: httptest.NewRecorder()}
		c, _ := gin.CreateTestContext(writer)
		if err = writeAgentSSE(c, event); err != nil {
			t.Fatal(err)
		}
		if writer.flushes != 1 || len(writer.deadlines) != 2 || writer.deadlines[0].IsZero() ||
			!writer.deadlines[1].IsZero() {
			t.Fatalf("write deadline leaked into idle time: %+v", writer)
		}
		lines := strings.SplitN(strings.TrimSpace(writer.Body.String()), "\n", 2)
		if len(lines) != 2 {
			t.Fatalf("invalid frame: %s", writer.Body.String())
		}
		if err = bundle.ValidateSSEEvent("POST", "/api/ai/agent/chat", event.Type,
			[]byte(strings.TrimPrefix(lines[1], "data:"))); err != nil {
			t.Fatal(err)
		}
		if event.Type == "thinking" && !strings.Contains(writer.Body.String(), `"roundID":"same-round"`) {
			t.Fatal("compaction lost its round identity")
		}
	}
}

func TestAgentSSEPropagatesFlushFailureThroughGin(t *testing.T) {
	failure := errors.New("flush deadline exceeded")
	writer := &agentDeadlineWriter{ResponseRecorder: httptest.NewRecorder(), flushErr: failure}
	c, _ := gin.CreateTestContext(writer)
	if err := writeAgentSSE(c, agent.AgentEvent{Type: "content", Token: "accepted"}); !errors.Is(err, failure) {
		t.Fatalf("Gin swallowed the flush failure: %v", err)
	}
	if !writer.deadlines[len(writer.deadlines)-1].IsZero() {
		t.Fatal("failed flush left a write deadline")
	}
}

func TestAgentSSESupportsRecorderWithoutWriteDeadline(t *testing.T) {
	writer := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(writer)
	if err := writeAgentSSE(c, agent.AgentEvent{Type: "done", TurnID: "turn"}); err != nil {
		t.Fatal(err)
	}
	if writer.Code != http.StatusOK || !writer.Flushed {
		t.Fatalf("unsupported deadline prevented delivery: %#v", writer)
	}
}

func TestAPIContractAgentFlushDeadlineDrainsAndReleasesSession(t *testing.T) {
	aiContractConfiguration(t)
	model.Conf.Variables.Store(conf.NewVariables())
	model.Conf.AI.Load().MCP = nil
	const sessionID = "20261105120000-evt4242"
	if _, _, err := agent.SaveSessionState([]byte(`{"id":"` + sessionID + `","title":"stream","createdAt":1,"updatedAt":1,"entries":[{"id":"user","type":"user","content":"hello"}]}`)); err != nil {
		t.Fatal(err)
	}
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprint(w, "data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"partial\"}}]}\n\n")
		w.(http.Flusher).Flush()
		<-r.Context().Done()
	}))
	defer upstream.Close()
	model.Conf.AI.Load().Providers = []*conf.Provider{{ID: "provider", Enabled: true,
		BaseURL: upstream.URL + "/v1", Protocol: "openai", APIKey: "test",
		Models: []*conf.Model{{ID: "model", Name: "model", Enabled: true}}}}
	engine := gin.New()
	engine.POST("/api/ai/agent/chat", agentChat)
	writer := &agentDeadlineWriter{ResponseRecorder: httptest.NewRecorder(), blockUntilDeadline: true}
	request := httptest.NewRequest("POST", "/api/ai/agent/chat", strings.NewReader(
		`{"sessionID":"`+sessionID+`","userEntryID":"user","contentRevision":1,"model":"model","message":"hello","language":"English"}`))
	engine.ServeHTTP(writer, request)
	if writer.flushes != 1 || !strings.Contains(writer.Body.String(), "event:turn") {
		t.Fatalf("route did not encounter the blocked turn flush: %s", writer.Body.String())
	}
	deadline := time.Now().Add(5 * time.Second)
	for {
		sessionsMu.Lock()
		_, running := runningSessions[sessionID]
		sessionsMu.Unlock()
		if !running {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("flush failure did not drain events and release the running session")
		}
		time.Sleep(10 * time.Millisecond)
	}
	session, err := agent.GetSession(sessionID)
	if err != nil {
		t.Fatal(err)
	}
	if session["recoveryTurnID"] == "" || session["recoveryTurnID"] == nil || session["recoveryState"] != "interrupted" {
		t.Fatalf("stream failure lost its recoverable turn: %#v", session)
	}
}
