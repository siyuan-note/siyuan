// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build windows

package util

import (
	"errors"

	"golang.org/x/sys/windows/registry"
)

func readSystemNetworkProxy() (*systemNetworkProxyConfig, error) {
	key, err := registry.OpenKey(registry.CURRENT_USER, `Software\Microsoft\Windows\CurrentVersion\Internet Settings`, registry.QUERY_VALUE)
	if err != nil {
		return nil, err
	}
	defer key.Close()

	autoConfigURL, _, err := key.GetStringValue("AutoConfigURL")
	if nil == err && "" != autoConfigURL {
		return nil, errors.New("automatic proxy configuration is not supported")
	}
	if nil != err && registry.ErrNotExist != err {
		return nil, err
	}
	autoDetect, _, err := key.GetIntegerValue("AutoDetect")
	if nil == err && 0 != autoDetect {
		return nil, errors.New("automatic proxy detection is not supported")
	}
	if nil != err && registry.ErrNotExist != err {
		return nil, err
	}

	enabled, _, err := key.GetIntegerValue("ProxyEnable")
	if registry.ErrNotExist == err {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if 0 == enabled {
		return nil, nil
	}

	proxyServer, _, err := key.GetStringValue("ProxyServer")
	if err != nil {
		return nil, err
	}
	proxyOverride, _, err := key.GetStringValue("ProxyOverride")
	if registry.ErrNotExist == err {
		proxyOverride = ""
	} else if err != nil {
		return nil, err
	}
	return parseSystemNetworkProxy(proxyServer, proxyOverride)
}
