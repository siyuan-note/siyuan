// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build darwin && !ios

package util

import (
	"context"
	"time"
)

func readSystemNetworkProxy() (*systemNetworkProxyConfig, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	return readMacOSNetworkProxy(ctx, readMacOSProxyCommand)
}
