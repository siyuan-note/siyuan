// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package util

import (
	"net"
	"testing"
)

func TestLANInterfaceFlags(t *testing.T) {
	ready := net.FlagUp | net.FlagRunning | net.FlagMulticast
	for _, tc := range []struct {
		name  string
		flags net.Flags
		want  bool
	}{
		{"wifi", ready, true},
		{"ethernet", ready | net.FlagBroadcast, true},
		{"no-carrier-bridge", ready &^ net.FlagRunning, false},
		{"down", ready &^ net.FlagUp, false},
		{"no-multicast", ready &^ net.FlagMulticast, false},
		{"tunnel", ready | net.FlagPointToPoint, false},
		{"loopback", ready | net.FlagLoopback, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := isLANInterface(net.Interface{Flags: tc.flags}); got != tc.want {
				t.Fatalf("got %v, want %v", got, tc.want)
			}
		})
	}
}
