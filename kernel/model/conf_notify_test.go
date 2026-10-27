// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import "testing"

// 客户端按命名空间读取配置段，未注册的命名空间不能发布通知，否则客户端读取失败并提示用户。
func TestNotifyConfChangedRequiresKnownNamespace(t *testing.T) {
	previousConf := Conf
	Conf = NewAppConf()
	t.Cleanup(func() { Conf = previousConf })

	before := ConfSettingRevision.Load()
	for _, namespace := range []string{"storage", "localStorage", "unknown"} {
		NotifyConfChanged(namespace)
		if ConfNamespaceRevision(namespace) != 0 || ConfSettingRevision.Load() != before {
			t.Fatalf("unknown namespace %q published a configuration notification", namespace)
		}
	}
	NotifyConfChanged("editor")
	if ConfNamespaceRevision("editor") == 0 || ConfSettingRevision.Load() == before {
		t.Fatal("registered namespace did not publish a configuration notification")
	}
}
