// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestSyncDNSErrorClassification(t *testing.T) {
	for _, test := range []struct {
		message string
		dns     bool
	}{
		{"dial tcp: lookup example.com: no such host", true},
		{"hostname resolution failed", true},
		{"no address associated with hostname", true},
		{"dial tcp 192.0.2.1:443: connectex: A connection attempt failed because the connected party did not properly respond after a period of time, or established connection failed because connected host has failed to respond.", false},
		{"connection failed: connection refused", false},
		{"context deadline exceeded", false},
		{"TLS handshake timeout", false},
	} {
		t.Run(test.message, func(t *testing.T) {
			if actual := isDNSError(strings.ToLower(test.message)); actual != test.dns {
				t.Fatalf("DNS classification = %v, want %v", actual, test.dns)
			}
			if !test.dns && flushAndRetryOnDNSError(errors.New(test.message)) {
				t.Fatal("non-DNS failure flushed DNS and requested a retry")
			}
		})
	}
	for _, cancellation := range []error{context.Canceled, context.DeadlineExceeded} {
		if flushAndRetryOnDNSError(errors.Join(errors.New("lookup example.com: no such host"), cancellation)) {
			t.Fatal("canceled DNS operation requested another sync")
		}
	}
}

func TestSyncDNSRetryFlushResult(t *testing.T) {
	previous := lastDNSFlushTime
	t.Cleanup(func() { lastDNSFlushTime = previous })
	dnsErr := errors.New("lookup example.com: no such host")
	for _, test := range []struct {
		name      string
		flushErr  error
		recent    bool
		wantRetry bool
	}{
		{"flushed", nil, false, true},
		{"failed", errors.New("exit status 1"), false, true},
		{"unsupported", errors.ErrUnsupported, false, true},
		{"recent", nil, true, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			lastDNSFlushTime = time.Time{}
			if test.recent {
				lastDNSFlushTime = time.Now()
			}
			before := lastDNSFlushTime
			calls := 0
			flush := func() error { calls++; return test.flushErr }
			if got := flushAndRetryOnDNSErrorWithFlush(dnsErr, flush); got != test.wantRetry {
				t.Fatalf("retry = %v, want %v", got, test.wantRetry)
			}
			if test.recent {
				if calls != 0 || lastDNSFlushTime != before {
					t.Fatal("throttled request flushed DNS or advanced the throttle")
				}
			} else if test.flushErr == nil {
				if calls != 1 || !lastDNSFlushTime.After(before) {
					t.Fatal("successful flush did not advance the throttle")
				}
				if flushAndRetryOnDNSErrorWithFlush(dnsErr, flush) || calls != 1 {
					t.Fatal("successful flush was not throttled")
				}
			} else {
				if calls != 1 || lastDNSFlushTime != before {
					t.Fatal("unsuccessful flush advanced the throttle")
				}
				if !flushAndRetryOnDNSErrorWithFlush(dnsErr, flush) || calls != 2 {
					t.Fatal("unsuccessful flush suppressed a later retry")
				}
			}
		})
	}
	for _, err := range []error{nil, errors.New("connection refused"),
		errors.Join(dnsErr, context.Canceled), errors.Join(dnsErr, context.DeadlineExceeded)} {
		if flushAndRetryOnDNSErrorWithFlush(err, func() error { t.Fatal("unexpected flush"); return nil }) {
			t.Fatal("non-DNS or canceled request retried")
		}
	}
}

func TestFormatRepoDNSError(t *testing.T) {
	previousConf, previousLangs := Conf, util.Langs
	t.Cleanup(func() { Conf, util.Langs = previousConf, previousLangs })
	Conf = &AppConf{Lang: "en", Sync: NewConfSection(&conf.Sync{Provider: conf.ProviderS3})}
	util.Langs = map[string]map[int]string{"en": {408: "check DNS settings", 24: "network timeout"}}
	for _, test := range []struct{ message, want string }{
		{"lookup example.com: no such host", "check DNS settings"},
		{"HOSTNAME RESOLUTION FAILED", "check DNS settings"},
		{"no address associated with hostname", "check DNS settings"},
		{"TLS handshake timeout", "network timeout"},
		{"context deadline exceeded", "network timeout"},
	} {
		if got := formatRepoErrorMsg(errors.New(test.message)); got != test.want+" (Provider: S3)" {
			t.Fatalf("message for %q = %q", test.message, got)
		}
	}
}
