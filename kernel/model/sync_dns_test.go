// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"context"
	"errors"
	"strings"
	"testing"
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
