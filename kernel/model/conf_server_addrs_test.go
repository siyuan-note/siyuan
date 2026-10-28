// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import "testing"

func TestUpdateServerAddrs(t *testing.T) {
	originalConf := Conf
	defer func() {
		Conf = originalConf
	}()
	Conf = nil
	if UpdateServerAddrs([]string{"http://127.0.0.1:6806"}) {
		t.Fatal("update without application configuration should be ignored")
	}
	Conf = NewAppConf()

	serverAddrs := []string{"http://192.168.43.1:6806", "http://127.0.0.1:6806"}
	if !UpdateServerAddrs(serverAddrs) {
		t.Fatal("first update should report a change")
	}
	serverAddrs[0] = "http://10.0.0.1:6806"
	if "http://192.168.43.1:6806" != Conf.ServerAddrs[0] {
		t.Fatal("server address update should copy its input")
	}
	if UpdateServerAddrs([]string{"http://192.168.43.1:6806", "http://127.0.0.1:6806"}) {
		t.Fatal("identical server addresses should not report a change")
	}
}
