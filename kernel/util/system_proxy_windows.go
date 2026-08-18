// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

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
