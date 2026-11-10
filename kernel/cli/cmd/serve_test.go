// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package cmd

import "testing"

func TestServeFixedPortFlag(t *testing.T) {
	flag := serveCmd.Flags().Lookup("fixed-port")
	if flag == nil || flag.DefValue != "true" {
		t.Fatal("serve must expose --fixed-port with default true")
	}
	previous, changed := serveFixedPort, flag.Changed
	t.Cleanup(func() {
		serveFixedPort, flag.Changed = previous, changed
	})
	for _, tc := range []struct {
		argument string
		want     bool
	}{
		{argument: "--fixed-port=false", want: false},
		{argument: "--fixed-port=true", want: true},
		{argument: "--fixed-port", want: true},
	} {
		t.Run(tc.argument, func(t *testing.T) {
			if err := serveCmd.ParseFlags([]string{tc.argument}); err != nil {
				t.Fatal(err)
			}
			if serveFixedPort != tc.want {
				t.Fatalf("fixed-port = %t, want %t", serveFixedPort, tc.want)
			}
		})
	}
	if err := serveCmd.ParseFlags([]string{"--fixed-port=invalid"}); err == nil {
		t.Fatal("invalid fixed-port boolean was accepted")
	}
}
