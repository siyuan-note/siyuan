// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build !windows && (!linux || android) && (!darwin || ios)

package util

func readSystemNetworkProxy() (*systemNetworkProxyConfig, error) {
	return nil, nil
}
