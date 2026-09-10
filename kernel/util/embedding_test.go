package util

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"sync/atomic"
	"testing"
	"time"
)

func TestEmbeddingConnectionRetry(t *testing.T) {
	for _, tc := range []struct {
		name      string
		failures  int32
		status    int
		wantCalls int32
		wantError bool
	}{
		{"recover", 1, 0, 2, false},
		{"bounded", 3, 0, 2, true},
		{"authentication", 1, http.StatusUnauthorized, 1, true},
		{"contextLimit", 1, http.StatusInternalServerError, 1, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var calls atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				var request struct {
					Input      []string `json:"input"`
					Model      string   `json:"model"`
					Dimensions int      `json:"dimensions"`
				}
				if err := json.NewDecoder(r.Body).Decode(&request); err != nil || len(request.Input) != 2 ||
					request.Input[0] != "first text" || request.Input[1] != "second text" ||
					request.Model != "test-model" || request.Dimensions != 2 {
					t.Errorf("unexpected request: %+v, error: %v", request, err)
				}
				if calls.Add(1) <= tc.failures {
					if tc.status != 0 {
						w.WriteHeader(tc.status)
						io.WriteString(w, `{"error":{"message":"rejected","type":"server_error"}}`)
						return
					}
					conn, _, err := w.(http.Hijacker).Hijack()
					if err != nil {
						t.Error(err)
						return
					}
					conn.Close()
					return
				}
				io.WriteString(w, `{"data":[{"index":0,"embedding":[1,0]},{"index":1,"embedding":[0,1]}]}`)
			}))
			defer server.Close()
			vectors, err := BatchGetEmbeddings([]string{"first text", "second text"}, "key", server.URL+"/v1", "test-model", 2, 5)
			if (err != nil) != tc.wantError || calls.Load() != tc.wantCalls {
				t.Fatalf("calls=%d, error=%v", calls.Load(), err)
			}
			if !tc.wantError && (len(vectors) != 2 || vectors[0][0] != 1 || vectors[1][1] != 1) {
				t.Fatalf("unexpected vectors: %v", vectors)
			}
		})
	}
}

func TestEmbeddingRetrySharesDeadline(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		select {
		case <-time.After(850 * time.Millisecond):
			conn, _, err := w.(http.Hijacker).Hijack()
			if err == nil {
				conn.Close()
			}
		case <-r.Context().Done():
		}
	}))
	defer server.Close()
	_, err := BatchGetEmbeddings([]string{"text"}, "key", server.URL, "model", 0, 1)
	if !errors.Is(err, context.DeadlineExceeded) || calls.Load() != 1 {
		t.Fatalf("calls=%d, error=%v", calls.Load(), err)
	}
}

func TestRetryableEmbeddingError(t *testing.T) {
	for _, tc := range []struct {
		err  error
		want bool
	}{
		{nil, false},
		{io.EOF, false},
		{&url.Error{Op: "Post", Err: io.EOF}, true},
		{&url.Error{Op: "Post", Err: errors.New("http: server closed idle connection")}, true},
		{&url.Error{Op: "Post", Err: context.Canceled}, false},
		{&url.Error{Op: "Post", Err: context.DeadlineExceeded}, false},
	} {
		if got := retryableEmbeddingError(tc.err); got != tc.want {
			t.Errorf("error=%v: got %v, want %v", tc.err, got, tc.want)
		}
	}
}
