// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package templatehttp

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"net/netip"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"text/template"
	"time"
)

type transportFunc func(*http.Request) (*http.Response, error)

func (f transportFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func response(status int, body string) *http.Response {
	return &http.Response{StatusCode: status, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(body))}
}

func TestConfirmationPrecedesNetworkAndDoesNotReplayTemplate(t *testing.T) {
	var confirmed, requests, values int
	e := New(context.Background(), "box", func(ctx context.Context, request Request) bool {
		if requests != 0 {
			t.Fatal("request before confirmation")
		}
		if request.Method != "GET" || strings.Contains(request.URL, "secret") {
			t.Fatalf("unsafe confirmation: %+v", request)
		}
		confirmed++
		return true
	})
	defer e.Close()
	e.transport = transportFunc(func(req *http.Request) (*http.Response, error) {
		if confirmed != 1 {
			t.Fatal("missing confirmation")
		}
		if req.URL.Query().Get("key") != "secret" {
			t.Fatal("wire URL changed")
		}
		requests++
		return response(200, `{"value":42}`), nil
	})
	functions := e.Funcs()
	functions["next"] = func() int { values++; return values }
	tpl := template.Must(template.New("").Funcs(functions).Parse(`{{$n := next}}{{$r := httpGet "https://example.com/data?key=secret"}}{{$n}}:{{$r.body}}`))
	var out bytes.Buffer
	if err := tpl.Execute(&out, nil); err != nil {
		t.Fatal(err)
	}
	if values != 1 || requests != 1 || out.String() != `1:{"value":42}` {
		t.Fatalf("replayed or invalid: %s", out.String())
	}
}

func TestDeniedNoninteractiveAndCanceledNeverSend(t *testing.T) {
	for _, kind := range []string{"denied", "interaction_required", "execution_ended"} {
		t.Run(kind, func(t *testing.T) {
			var confirm func(context.Context, Request) bool
			if kind == "denied" {
				confirm = func(context.Context, Request) bool { return false }
			}
			e := New(context.Background(), "", confirm)
			defer e.Close()
			e.transport = transportFunc(func(*http.Request) (*http.Response, error) { t.Fatal("unexpected network"); return nil, nil })
			if kind == "execution_ended" {
				e.Close()
			}
			if got := e.Get("https://example.com")["error"]; got != kind {
				t.Fatalf("got %v", got)
			}
		})
	}
}

func TestCancellationDuringConfirmationAndCachedRead(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	entered := make(chan struct{})
	e := New(ctx, "", func(ctx context.Context, _ Request) bool { close(entered); <-ctx.Done(); return true })
	defer e.Close()
	done := make(chan map[string]any)
	go func() { done <- e.Get("https://example.com") }()
	<-entered
	cancel()
	if got := (<-done)["error"]; got != "execution_ended" {
		t.Fatal(got)
	}
	if got := e.Get("https://example.com")["error"]; got != "execution_ended" {
		t.Fatal(got)
	}
}

func TestDedupScopesCredentialsAndConcurrentRows(t *testing.T) {
	var requests atomic.Int32
	e := New(context.Background(), "root", func(context.Context, Request) bool { return true })
	defer e.Close()
	e.transport = transportFunc(func(*http.Request) (*http.Response, error) { requests.Add(1); return response(200, "value"), nil })
	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); e.Get("https://example.com") }()
	}
	wg.Wait()
	if requests.Load() != 1 {
		t.Fatal(requests.Load())
	}
	for _, scope := range []string{"box-a", "box-b"} {
		get := e.FuncsForScope(scope)["httpGet"].(func(string, ...map[string]any) (map[string]any, error))
		for _, token := range []string{"a", "b", "a"} {
			get("https://example.com", map[string]any{"headers": map[string]any{"Authorization": token}})
		}
	}
	if requests.Load() != 5 {
		t.Fatal(requests.Load())
	}
	e.Close()
	if e.Get("https://example.com")["error"] != "execution_ended" {
		t.Fatal("cached result after close")
	}
}

func TestRedirectRequiresConfirmationAndDropsAllCredentials(t *testing.T) {
	var confirms, requests int
	e := New(context.Background(), "", func(context.Context, Request) bool { confirms++; return true })
	defer e.Close()
	e.transport = transportFunc(func(req *http.Request) (*http.Response, error) {
		requests++
		if confirms != requests {
			t.Fatal("redirect sent before confirmation")
		}
		if requests == 1 {
			r := response(302, "")
			r.Header.Set("Location", "https://other.example.com/data")
			return r, nil
		}
		if len(req.Header) != 0 {
			t.Fatalf("credentials crossed origin: %v", req.Header)
		}
		return response(200, "ok"), nil
	})
	r := e.Get("https://example.com", map[string]any{"headers": map[string]any{"Authorization": "secret", "X-Api-Key": "secret"}})
	if r["ok"] != true || confirms != 2 {
		t.Fatal(r)
	}
}

func TestRedirectDeniedAndPrivateTarget(t *testing.T) {
	for _, location := range []string{"https://other.example.com", "http://127.0.0.1", "http://[::1]", "file:///etc/passwd"} {
		t.Run(location, func(t *testing.T) {
			var confirms, requests int
			e := New(context.Background(), "", func(context.Context, Request) bool { confirms++; return confirms == 1 })
			defer e.Close()
			e.transport = transportFunc(func(*http.Request) (*http.Response, error) {
				requests++
				r := response(302, "")
				r.Header.Set("Location", location)
				return r, nil
			})
			if e.Get("https://example.com")["ok"] != false || requests != 1 {
				t.Fatal("redirect sent")
			}
		})
	}
}

func TestResponseFailuresAndLimits(t *testing.T) {
	for _, test := range []struct {
		name   string
		status int
		body   string
		err    error
		want   string
	}{
		{"non-2xx", 404, "not found", nil, "http_status"},
		{"invalid-json-is-data", 200, "not json", nil, ""},
		{"offline", 0, "", errors.New("secret URL"), "network_error"},
		{"too-large", 200, strings.Repeat("x", maxBody+1), nil, "response_too_large"},
	} {
		t.Run(test.name, func(t *testing.T) {
			e := New(context.Background(), "", func(context.Context, Request) bool { return true })
			defer e.Close()
			e.transport = transportFunc(func(*http.Request) (*http.Response, error) {
				if test.err != nil {
					return nil, test.err
				}
				return response(test.status, test.body), nil
			})
			r := e.Get("https://example.com")
			if r["error"] != test.want {
				t.Fatal(r)
			}
			if test.want == "response_too_large" && r["body"] != "" {
				t.Fatal("silently truncated")
			}
		})
	}
}

func TestRequestTimeoutAndConfirmationDoesNotOccupyNetworkSlot(t *testing.T) {
	e := New(context.Background(), "", func(context.Context, Request) bool {
		if len(networkSlots) != 0 {
			t.Fatal("slot acquired during confirmation")
		}
		return true
	})
	defer e.Close()
	e.transport = transportFunc(func(req *http.Request) (*http.Response, error) {
		<-req.Context().Done()
		return nil, req.Context().Err()
	})
	if got := e.Get("https://example.com", map[string]any{"timeout": 0.001})["error"]; got != "timeout" {
		t.Fatal(got)
	}
	if len(networkSlots) != 0 {
		t.Fatal("network slot leaked")
	}
}

func TestBudgetCountsCachedAndDeniedCalls(t *testing.T) {
	e := New(context.Background(), "", func(context.Context, Request) bool { return false })
	defer e.Close()
	for i := 0; i < maxCalls; i++ {
		if e.Get("https://example.com")["error"] != "denied" {
			t.Fatal(i)
		}
	}
	if e.Get("https://example.com")["error"] != "budget_exceeded" {
		t.Fatal("unbounded cached calls")
	}
	e2 := New(context.Background(), "", func(context.Context, Request) bool { return false })
	defer e2.Close()
	for i := 0; i < maxRequests; i++ {
		e2.Get("https://example.com/" + strings.Repeat("x", i))
	}
	if e2.Get("https://example.com/new")["error"] != "budget_exceeded" {
		t.Fatal("unbounded denied requests")
	}
}

func TestPublicAddressPolicyAndActualDialValidation(t *testing.T) {
	for _, address := range []string{"127.0.0.1", "10.0.0.1", "172.16.1.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "198.18.0.1", "0.0.0.0", "224.0.0.1", "240.0.0.1", "::1", "::ffff:127.0.0.1", "fc00::1", "fe80::1", "64:ff9b::a00:1", "2002:7f00:1::", "2001::1", "2001:db8::1"} {
		if !unsafeIP(netip.MustParseAddr(address)) {
			t.Errorf("allowed %s", address)
		}
	}
	for _, address := range []string{"8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"} {
		if unsafeIP(netip.MustParseAddr(address)) {
			t.Errorf("rejected %s", address)
		}
	}
	transport := newTransport()
	defer transport.CloseIdleConnections()
	if transport.Proxy != nil {
		t.Fatal("environment proxy enabled")
	}
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if conn, err := transport.DialContext(ctx, "tcp", listener.Addr().String()); err == nil {
		conn.Close()
		t.Fatal("actual loopback dial allowed")
	} else if !errors.Is(err, errUnsafeAddress) {
		t.Fatal(err)
	}
	_, port, _ := net.SplitHostPort(listener.Addr().String())
	if conn, err := transport.DialContext(ctx, "tcp", net.JoinHostPort("localhost", port)); err == nil {
		conn.Close()
		t.Fatal("hostname resolving to loopback allowed")
	} else if !errors.Is(err, errUnsafeAddress) {
		t.Fatal(err)
	}
}

func TestOptionsAndURLsRejectUnsafeInput(t *testing.T) {
	for _, raw := range []string{"file:///tmp/x", "http://user:password@example.com", "https://example.com:0", "https://[fe80::1%25eth0]", "http://127.0.0.1"} {
		if _, err := validateURL(raw); err == nil {
			t.Fatal(raw)
		}
	}
	for _, options := range []map[string]any{
		{"method": "POST"}, {"timeout": 11}, {"timeout": -1},
		{"headers": map[string]any{"Proxy-Authorization": "secret"}},
		{"headers": map[string]any{"X-Key": "secret\r\ninjected"}},
	} {
		if _, _, err := parseOptions([]map[string]any{options}); err == nil {
			t.Fatal(options)
		}
	}
}

func TestTotalBodyBudgetAndCacheCannotBeMutated(t *testing.T) {
	requests := 0
	e := New(context.Background(), "", func(context.Context, Request) bool { return true })
	defer e.Close()
	e.transport = transportFunc(func(*http.Request) (*http.Response, error) {
		requests++
		return response(200, strings.Repeat("x", maxBody)), nil
	})
	first := e.Get("https://example.com/first")
	first["body"] = "mutated"
	if e.Get("https://example.com/first")["body"] == "mutated" {
		t.Fatal("mutable shared cache")
	}
	for i := 1; i < maxTotalBody/maxBody; i++ {
		e.Get("https://example.com/" + strings.Repeat("x", i))
	}
	if got := e.Get("https://example.com/overflow")["error"]; got != "budget_exceeded" {
		t.Fatal(got)
	}
	if requests != maxTotalBody/maxBody {
		t.Fatal(requests)
	}
}

func TestLateNetworkCompletionCannotReturnData(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	e := New(ctx, "", func(context.Context, Request) bool { return true })
	defer e.Close()
	e.transport = transportFunc(func(*http.Request) (*http.Response, error) { cancel(); return response(200, "private data"), nil })
	r := e.Get("https://example.com")
	if r["error"] != "execution_ended" || r["body"] != "" {
		t.Fatal(r)
	}
}

func TestRedirectLimitAndNoConfirmationNetworkSlot(t *testing.T) {
	requests := 0
	e := New(context.Background(), "", func(context.Context, Request) bool {
		if len(networkSlots) != 0 {
			t.Fatal("redirect confirmation holds network slot")
		}
		return true
	})
	defer e.Close()
	e.transport = transportFunc(func(*http.Request) (*http.Response, error) {
		requests++
		r := response(302, "")
		r.Header.Set("Location", "/next")
		return r, nil
	})
	if e.Get("https://example.com")["error"] != "redirect_limit" || requests != maxRedirects+1 {
		t.Fatal(requests)
	}
}

func TestGlobalNetworkConcurrencyIsBounded(t *testing.T) {
	var active, peak atomic.Int32
	var wg sync.WaitGroup
	for i := 0; i < 12; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			e := New(context.Background(), "", func(context.Context, Request) bool { return true })
			defer e.Close()
			e.transport = transportFunc(func(*http.Request) (*http.Response, error) {
				n := active.Add(1)
				for old := peak.Load(); n > old; old = peak.Load() {
					if peak.CompareAndSwap(old, n) {
						break
					}
				}
				time.Sleep(10 * time.Millisecond)
				active.Add(-1)
				return response(200, "ok"), nil
			})
			if e.Get("https://example.com")["ok"] != true {
				t.Error("request failed")
			}
		}()
	}
	wg.Wait()
	if peak.Load() > 4 || peak.Load() == 0 || len(networkSlots) != 0 {
		t.Fatalf("invalid concurrency: %d", peak.Load())
	}
}

func TestErrorHandlerReportsOnlyFreshSafeCodes(t *testing.T) {
	e := New(context.Background(), "", func(context.Context, Request) bool { return true })
	defer e.Close()
	var codes []string
	e.SetErrorHandler(func(code string) { codes = append(codes, code) })
	e.transport = transportFunc(func(*http.Request) (*http.Response, error) {
		return nil, errors.New("secret URL and credentials")
	})
	for i := 0; i < 3; i++ {
		e.Get("https://example.com?key=secret")
	}
	if len(codes) != 1 || codes[0] != "network_error" {
		t.Fatal(codes)
	}
	e.transport = transportFunc(func(*http.Request) (*http.Response, error) { return response(200, "ok"), nil })
	e.Get("https://example.com/ok")
	if len(codes) != 1 {
		t.Fatal("success notified")
	}
	e.calls = maxCalls
	e.Get("https://example.com/ok")
	if len(codes) != 2 || codes[1] != "budget_exceeded" {
		t.Fatal(codes)
	}
	if e.Err() == nil || len(e.cache) != 0 {
		t.Fatal("budget did not end and clear execution")
	}
	e.Get("https://example.com/ok")
	if len(codes) != 2 {
		t.Fatal("ended execution notified")
	}
}

func TestErrorHandlerCanCloseExecution(t *testing.T) {
	e := New(context.Background(), "", func(context.Context, Request) bool { return false })
	e.SetErrorHandler(func(code string) {
		if code != "denied" {
			t.Error(code)
		}
		e.Close()
	})
	e.Get("https://example.com")
	if e.Err() == nil {
		t.Fatal("error callback did not close execution")
	}
}

func TestWriterSharesOutputBudgetAndRejectsWholeOverflow(t *testing.T) {
	e := New(context.Background(), "", nil)
	defer e.Close()
	var codes []string
	e.SetErrorHandler(func(code string) {
		codes = append(codes, code)
		e.Close()
	})
	var first, second bytes.Buffer
	if n, err := e.Writer(&first).Write(bytes.Repeat([]byte("x"), maxOutput-1)); err != nil || n != maxOutput-1 {
		t.Fatal(n, err)
	}
	if n, err := e.Writer(&second).Write([]byte("y")); err != nil || n != 1 {
		t.Fatal(n, err)
	}
	if n, err := e.Writer(&second).Write([]byte("overflow")); n != 0 || !errors.Is(err, errOutputLimit) {
		t.Fatal(n, err)
	}
	if second.String() != "y" || e.Err() == nil || len(codes) != 1 || codes[0] != "budget_exceeded" {
		t.Fatal(second.String(), e.Err(), codes)
	}
	if n, err := e.Writer(&second).Write([]byte("late")); n != 0 || !errors.Is(err, context.Canceled) {
		t.Fatal(n, err)
	}
	if len(codes) != 1 {
		t.Fatal("duplicate error notification")
	}
}

func TestTemplateWriterStopsAfterCancellation(t *testing.T) {
	e := New(context.Background(), "", nil)
	defer e.Close()
	var output bytes.Buffer
	tpl := template.Must(template.New("").Funcs(template.FuncMap{"closeExecution": func() string { e.Close(); return "sensitive" }}).Parse(`before{{closeExecution}}after`))
	if err := tpl.Execute(e.Writer(&output), nil); err == nil {
		t.Fatal("template ignored cancellation")
	}
	if output.String() != "before" {
		t.Fatal(output.String())
	}
}

func TestWriterConcurrentBudgetReservation(t *testing.T) {
	e := New(context.Background(), "", nil)
	defer e.Close()
	var notifications atomic.Int32
	e.SetErrorHandler(func(string) { notifications.Add(1) })
	var wg sync.WaitGroup
	for i := 0; i < 16; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); _, _ = e.Writer(io.Discard).Write(make([]byte, maxOutput/8)) }()
	}
	wg.Wait()
	if e.outputBytes > maxOutput || notifications.Load() != 1 || e.Err() == nil {
		t.Fatal(e.outputBytes, notifications.Load(), e.Err())
	}
}

func TestCanceledHTTPFunctionStopsOutputFreeTemplateLoop(t *testing.T) {
	var e *Execution
	calls := 0
	e = New(context.Background(), "", func(context.Context, Request) bool {
		calls++
		e.Close()
		return false
	})
	defer e.Close()
	tpl := template.Must(template.New("").Funcs(e.Funcs()).Parse(`{{range .}}{{$result := httpGet "https://example.com"}}{{end}}`))
	if err := tpl.Execute(io.Discard, make([]int, 10000)); err == nil {
		t.Fatal("canceled function continued template")
	}
	if calls != 1 || e.calls != 1 {
		t.Fatal(calls, e.calls)
	}
}

func TestOrdinaryHTTPFailureAllowsTemplateFallback(t *testing.T) {
	e := New(context.Background(), "", func(context.Context, Request) bool { return false })
	defer e.Close()
	tpl := template.Must(template.New("").Funcs(e.Funcs()).Parse(`{{$result := httpGet "https://example.com"}}{{if $result.ok}}network{{else}}fallback{{end}}`))
	var output bytes.Buffer
	if err := tpl.Execute(&output, nil); err != nil {
		t.Fatal(err)
	}
	if output.String() != "fallback" || e.Err() != nil {
		t.Fatal(output.String(), e.Err())
	}
}

func TestPreflightFailuresNotifyOncePerCodeWithoutNetwork(t *testing.T) {
	e := New(context.Background(), "", nil)
	defer e.Close()
	var codes []string
	e.SetErrorHandler(func(code string) { codes = append(codes, code) })
	e.transport = transportFunc(func(*http.Request) (*http.Response, error) {
		t.Fatal("preflight failure sent request")
		return nil, nil
	})
	for i := 0; i < 5; i++ {
		e.Get("http://127.0.0.1/?key=secret")
		e.Get("https://example.com", map[string]any{"unsupported": "secret"})
		e.Get("https://example.com")
	}
	if strings.Join(codes, ",") != "invalid_target,invalid_options,interaction_required" {
		t.Fatal(codes)
	}
	if e.Err() != nil {
		t.Fatal(e.Err())
	}
}

func previewApprovals(t *testing.T, scope, target string, options ...map[string]any) *Approvals {
	t.Helper()
	e := New(context.Background(), scope, func(context.Context, Request) bool { return true })
	defer e.Close()
	e.transport = transportFunc(func(*http.Request) (*http.Response, error) { return response(200, "preview"), nil })
	if e.Get(target, options...)["ok"] != true {
		t.Fatal("preview failed")
	}
	a := e.ExportApprovals()
	if a == nil {
		t.Fatal("missing approvals")
	}
	if e.ExportApprovals() != nil {
		t.Fatal("approvals exported twice")
	}
	return a
}

func TestApprovalHandoffFetchesFreshResponseWithoutReconfirmation(t *testing.T) {
	options := map[string]any{"headers": map[string]any{"Authorization": "secret"}, "timeout": 1}
	a := previewApprovals(t, "box", "https://example.com?key=secret", options)
	defer a.Close()
	confirmations, requests := 0, 0
	e := New(context.Background(), "box", func(context.Context, Request) bool { confirmations++; return true })
	defer e.Close()
	e.transport = transportFunc(func(*http.Request) (*http.Response, error) { requests++; return response(200, "fresh insertion"), nil })
	if !e.ImportApprovals(a) {
		t.Fatal("handoff rejected")
	}
	options["timeout"] = 2
	r := e.Get("https://example.com?key=secret", options)
	if r["body"] != "fresh insertion" || confirmations != 0 || requests != 1 {
		t.Fatal(r, confirmations, requests)
	}
	if e.ExportApprovals() != nil {
		t.Fatal("inherited authorization exported again")
	}
	other := New(context.Background(), "box", func(context.Context, Request) bool { return true })
	defer other.Close()
	if other.ImportApprovals(a) {
		t.Fatal("handoff consumed twice")
	}
}

func TestApprovalHandoffRequiresExactURLHeadersAndScopes(t *testing.T) {
	for _, change := range []string{"query", "headers", "root-scope", "actual-scope"} {
		t.Run(change, func(t *testing.T) {
			options := map[string]any{"headers": map[string]any{"Authorization": "secret"}}
			a := previewApprovals(t, "box", "https://example.com?key=secret", options)
			defer a.Close()
			scope, actualScope, target := "box", "box", "https://example.com?key=secret"
			switch change {
			case "query":
				target = "https://example.com?key=different"
			case "headers":
				options["headers"] = map[string]any{"Authorization": "changed"}
			case "root-scope":
				scope = "other-box"
			case "actual-scope":
				actualScope = "related-box"
			}
			confirmations := 0
			e := New(context.Background(), scope, func(context.Context, Request) bool { confirmations++; return false })
			defer e.Close()
			if !e.ImportApprovals(a) {
				t.Fatal("handoff rejected before matching")
			}
			r := e.getScoped(actualScope, target, options)
			if r["error"] != "denied" || confirmations != 1 {
				t.Fatal(r, confirmations)
			}
		})
	}
}

func TestApprovalHandoffChecksEveryRedirect(t *testing.T) {
	preview := New(context.Background(), "box", func(context.Context, Request) bool { return true })
	preview.transport = transportFunc(func(req *http.Request) (*http.Response, error) {
		if req.URL.Path == "/start" {
			r := response(302, "")
			r.Header.Set("Location", "/approved")
			return r, nil
		}
		return response(200, "preview"), nil
	})
	if preview.Get("https://example.com/start")["ok"] != true {
		t.Fatal("preview failed")
	}
	a := preview.ExportApprovals()
	preview.Close()
	defer a.Close()
	confirmations, requests := 0, 0
	insertion := New(context.Background(), "box", func(_ context.Context, request Request) bool {
		confirmations++
		if request.URL != "https://example.com/new-target" {
			t.Error(request.URL)
		}
		return false
	})
	defer insertion.Close()
	if !insertion.ImportApprovals(a) {
		t.Fatal("handoff rejected")
	}
	insertion.transport = transportFunc(func(*http.Request) (*http.Response, error) {
		requests++
		r := response(302, "")
		r.Header.Set("Location", "/new-target")
		return r, nil
	})
	if insertion.Get("https://example.com/start")["error"] != "denied" || confirmations != 1 || requests != 1 {
		t.Fatal(confirmations, requests)
	}
}

func TestFailedOrCanceledPreviewCannotExportApprovals(t *testing.T) {
	for _, failure := range []string{"network", "http-status", "denied", "invalid-target", "canceled"} {
		t.Run(failure, func(t *testing.T) {
			allow := true
			e := New(context.Background(), "box", func(context.Context, Request) bool { return allow })
			defer e.Close()
			e.transport = transportFunc(func(*http.Request) (*http.Response, error) { return response(200, "ok"), nil })
			e.Get("https://example.com/success")
			switch failure {
			case "network":
				e.transport = transportFunc(func(*http.Request) (*http.Response, error) { return nil, errors.New("offline") })
			case "http-status":
				e.transport = transportFunc(func(*http.Request) (*http.Response, error) { return response(500, "failed"), nil })
			case "denied":
				allow = false
			case "invalid-target":
				e.Get("http://127.0.0.1")
			case "canceled":
				e.Close()
			}
			e.Get("https://example.com/failure")
			if e.ExportApprovals() != nil {
				t.Fatal("failed preview exported approvals")
			}
		})
	}
}

func TestApprovalHandoffExpiryAndCancellation(t *testing.T) {
	for _, state := range []string{"expired-before-import", "expired-after-import", "closed", "canceled-execution"} {
		t.Run(state, func(t *testing.T) {
			a := previewApprovals(t, "box", "https://example.com")
			defer a.Close()
			confirmations := 0
			e := New(context.Background(), "box", func(context.Context, Request) bool { confirmations++; return false })
			defer e.Close()
			switch state {
			case "expired-before-import":
				a.expires = time.Now().Add(-time.Second)
			case "closed":
				a.Close()
			case "canceled-execution":
				e.Close()
			}
			imported := e.ImportApprovals(a)
			if state == "expired-after-import" {
				if !imported {
					t.Fatal("fresh handoff rejected")
				}
				e.inheritedExpires = time.Now().Add(-time.Second)
			} else if imported {
				t.Fatal("invalid handoff accepted")
			}
			r := e.Get("https://example.com")
			if state == "canceled-execution" {
				if r["error"] != "execution_ended" || confirmations != 0 {
					t.Fatal(r, confirmations)
				}
			} else if r["error"] != "denied" || confirmations != 1 {
				t.Fatal(r, confirmations)
			}
		})
	}
}

func TestOrdinaryExecutionStillConfirmsWithoutHandoff(t *testing.T) {
	a := previewApprovals(t, "box", "https://example.com")
	defer a.Close()
	confirmations := 0
	e := New(context.Background(), "box", func(context.Context, Request) bool { confirmations++; return false })
	defer e.Close()
	if e.Get("https://example.com")["error"] != "denied" || confirmations != 1 {
		t.Fatal("ordinary execution inherited approval")
	}
	if e.ImportApprovals(a) {
		t.Fatal("approval imported after execution started")
	}
	background := New(context.Background(), "box", nil)
	defer background.Close()
	if background.ImportApprovals(a) {
		t.Fatal("noninteractive execution inherited approval")
	}
}

func TestApprovalHandoffConcurrentConsumptionIsSingleUse(t *testing.T) {
	a := previewApprovals(t, "box", "https://example.com")
	defer a.Close()
	var accepted atomic.Int32
	var wg sync.WaitGroup
	for i := 0; i < 12; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			e := New(context.Background(), "box", func(context.Context, Request) bool { return false })
			defer e.Close()
			if e.ImportApprovals(a) {
				accepted.Add(1)
			}
		}()
	}
	wg.Wait()
	if accepted.Load() != 1 {
		t.Fatal(accepted.Load())
	}
}

func TestFailedRedirectChainDoesNotExportApproval(t *testing.T) {
	e := New(context.Background(), "box", func(context.Context, Request) bool { return true })
	defer e.Close()
	e.transport = transportFunc(func(req *http.Request) (*http.Response, error) {
		if req.URL.Path == "/start" {
			r := response(302, "")
			r.Header.Set("Location", "/failed")
			return r, nil
		}
		return response(500, "failed"), nil
	})
	e.Get("https://example.com/start")
	if e.ExportApprovals() != nil {
		t.Fatal("failed redirect chain granted approval")
	}
}

func TestApprovalHandoffReusesExactRedirectChainButNotBudgets(t *testing.T) {
	chain := transportFunc(func(req *http.Request) (*http.Response, error) {
		if req.URL.Path == "/start" {
			r := response(302, "")
			r.Header.Set("Location", "https://other.example.com/end")
			return r, nil
		}
		if req.Header.Get("Authorization") != "" {
			t.Error("cross-origin credential leaked")
		}
		return response(200, "fresh"), nil
	})
	options := map[string]any{"headers": map[string]any{"Authorization": "secret"}}
	preview := New(context.Background(), "box", func(context.Context, Request) bool { return true })
	preview.transport = chain
	preview.Get("https://example.com/start", options)
	a := preview.ExportApprovals()
	preview.Close()
	defer a.Close()
	confirmations := 0
	insertion := New(context.Background(), "box", func(context.Context, Request) bool { confirmations++; return false })
	defer insertion.Close()
	insertion.transport = chain
	if !insertion.ImportApprovals(a) {
		t.Fatal("handoff rejected")
	}
	if insertion.Get("https://example.com/start", options)["body"] != "fresh" || confirmations != 0 || insertion.requests != 2 {
		t.Fatal(confirmations, insertion.requests)
	}
	insertion.requests = maxRequests
	options["timeout"] = 1
	if insertion.Get("https://example.com/start", options)["error"] != "budget_exceeded" || insertion.Err() == nil {
		t.Fatal("inherited approval bypassed request budget")
	}
}

func TestApprovalHandoffCannotMixPreviouslyApprovedRedirectChains(t *testing.T) {
	for _, sharedMiddle := range []bool{false, true} {
		t.Run(strconv.FormatBool(sharedMiddle), func(t *testing.T) {
			preview := New(context.Background(), "box", func(context.Context, Request) bool { return true })
			root := ""
			preview.transport = transportFunc(func(req *http.Request) (*http.Response, error) {
				path := req.URL.Path
				if path == "/a" || path == "/c" {
					root = path
				}
				location := ""
				switch {
				case sharedMiddle && (path == "/a" || path == "/c"):
					location = "/middle"
				case path == "/a" || path == "/middle" && root == "/a":
					location = "/b"
				case path == "/c" || path == "/middle" && root == "/c":
					location = "/d"
				}
				if location != "" {
					r := response(302, "")
					r.Header.Set("Location", location)
					return r, nil
				}
				return response(200, "preview"), nil
			})
			for _, path := range []string{"/a", "/c", "/d"} {
				if preview.Get("https://example.com" + path)["ok"] != true {
					t.Fatal("preview failed", path)
				}
			}
			a := preview.ExportApprovals()
			preview.Close()
			defer a.Close()
			confirmations, requests := 0, 0
			insertion := New(context.Background(), "box", func(_ context.Context, request Request) bool {
				confirmations++
				if request.URL != "https://example.com/d" {
					t.Error("unexpected confirmation", request.URL)
				}
				return false
			})
			defer insertion.Close()
			if !insertion.ImportApprovals(a) {
				t.Fatal("handoff rejected")
			}
			insertion.transport = transportFunc(func(req *http.Request) (*http.Response, error) {
				requests++
				location := "/d"
				if sharedMiddle && req.URL.Path == "/a" {
					location = "/middle"
				}
				r := response(302, "")
				r.Header.Set("Location", location)
				return r, nil
			})
			r := insertion.Get("https://example.com/a")
			wantRequests := 1
			if sharedMiddle {
				wantRequests = 2
			}
			if r["error"] != "denied" || confirmations != 1 || requests != wantRequests {
				t.Fatal(r, confirmations, requests)
			}
		})
	}
}

func TestRequestGuardRejectsCachedResultsAfterRevocation(t *testing.T) {
	e := New(context.Background(), "box", func(context.Context, Request) bool { return true })
	defer e.Close()
	allowed := true
	requests, checks := 0, 0
	e.SetRequestGuard(func(ctx context.Context, scope string) bool {
		checks++
		if ctx != e.ctx || scope != "box" {
			t.Fatal("wrong source guard context", scope)
		}
		return allowed
	})
	e.transport = transportFunc(func(*http.Request) (*http.Response, error) { requests++; return response(200, "private"), nil })
	if e.Get("https://example.com")["body"] != "private" {
		t.Fatal("first request failed")
	}
	previousChecks := checks
	if e.Get("https://example.com")["body"] != "private" || checks <= previousChecks {
		t.Fatal("cache bypassed guard")
	}
	allowed = false
	r := e.Get("https://example.com")
	if r["error"] != "execution_ended" || r["body"] != "" || e.Err() == nil || requests != 1 || len(e.cache) != 0 {
		t.Fatal(r, requests)
	}
}

func TestRequestGuardChecksInheritedApprovalAfterImport(t *testing.T) {
	a := previewApprovals(t, "box", "https://example.com")
	defer a.Close()
	confirmations := 0
	e := New(context.Background(), "box", func(context.Context, Request) bool { confirmations++; return true })
	defer e.Close()
	if !e.ImportApprovals(a) {
		t.Fatal("handoff rejected")
	}
	e.SetRequestGuard(func(context.Context, string) bool { return false })
	e.transport = transportFunc(func(*http.Request) (*http.Response, error) {
		t.Fatal("revoked inherited request sent")
		return nil, nil
	})
	if e.Get("https://example.com")["error"] != "execution_ended" || confirmations != 0 || e.Err() == nil {
		t.Fatal("handoff bypassed guard")
	}
}

func TestRequestGuardRechecksAfterConfirmationAndOnRedirect(t *testing.T) {
	for _, stage := range []string{"confirmation", "redirect-confirmation"} {
		t.Run(stage, func(t *testing.T) {
			allowed := true
			confirmations, requests := 0, 0
			e := New(context.Background(), "box", func(context.Context, Request) bool {
				confirmations++
				if stage == "confirmation" || confirmations == 2 {
					allowed = false
				}
				return true
			})
			defer e.Close()
			e.SetRequestGuard(func(context.Context, string) bool { return allowed })
			e.transport = transportFunc(func(*http.Request) (*http.Response, error) {
				requests++
				r := response(302, "")
				r.Header.Set("Location", "/next")
				return r, nil
			})
			r := e.Get("https://example.com")
			wantRequests := 0
			if stage == "redirect-confirmation" {
				wantRequests = 1
			}
			if r["error"] != "execution_ended" || requests != wantRequests || e.Err() == nil {
				t.Fatal(r, requests)
			}
		})
	}
}

func TestRequestGuardDiscardsResponseAndUsesActualScope(t *testing.T) {
	allowed := true
	e := New(context.Background(), "root-box", func(context.Context, Request) bool { return true })
	defer e.Close()
	e.SetRequestGuard(func(_ context.Context, scope string) bool {
		if scope != "related-box\x00database" {
			t.Fatal("guard received root instead of actual scope", scope)
		}
		return allowed
	})
	e.transport = transportFunc(func(*http.Request) (*http.Response, error) {
		allowed = false
		return response(200, "stale private data"), nil
	})
	get := e.FuncsForScope("related-box\x00database")["httpGet"].(func(string, ...map[string]any) (map[string]any, error))
	r, err := get("https://example.com")
	if err == nil || r != nil || e.ExportApprovals() != nil {
		t.Fatal("revocation allowed fallback or old data", r, err)
	}
}

func TestRequestGuardMayCloseExecutionWithoutDeadlock(t *testing.T) {
	e := New(context.Background(), "box", func(context.Context, Request) bool { return true })
	defer e.Close()
	e.SetRequestGuard(func(context.Context, string) bool { e.Close(); return true })
	if e.Get("https://example.com")["error"] != "execution_ended" {
		t.Fatal("guard cancellation ignored")
	}
}

func TestRequestStartedOnlyForActualNetworkIncludingInheritedApproval(t *testing.T) {
	preview := New(context.Background(), "scope", func(context.Context, Request) bool { return true })
	defer preview.Close()
	preview.transport = transportFunc(func(*http.Request) (*http.Response, error) { return response(200, "preview"), nil })
	started := 0
	preview.SetRequestStarted(func() { started++ })
	preview.Get("https://example.com/data")
	preview.Get("https://example.com/data")
	if started != 1 {
		t.Fatalf("cached request notified start: %d", started)
	}
	approvals := preview.ExportApprovals()
	insert := New(context.Background(), "scope", func(context.Context, Request) bool { t.Fatal("inherited request prompted"); return false })
	defer insert.Close()
	insert.transport = transportFunc(func(*http.Request) (*http.Response, error) { return response(200, "fresh"), nil })
	insert.SetRequestStarted(func() { started++ })
	if !insert.ImportApprovals(approvals) {
		t.Fatal("could not import approval")
	}
	insert.Get("https://example.com/data")
	if started != 2 {
		t.Fatalf("inherited actual request did not notify start: %d", started)
	}
	denied := New(context.Background(), "scope", func(context.Context, Request) bool { return false })
	defer denied.Close()
	denied.SetRequestStarted(func() { t.Fatal("denial notified request start") })
	denied.Get("https://example.com/data")
}
