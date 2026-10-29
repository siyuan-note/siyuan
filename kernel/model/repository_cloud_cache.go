// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import "github.com/siyuan-note/dejavu"

// 云端列表缓存仅用于面板读取，来源与密钥隔离由缓存按实际仓库配置检查，不参与同步写入。
var cloudRepoSnapshotCache dejavu.CloudSnapshotCache
