package model

import "github.com/siyuan-note/dejavu"

// 云端列表缓存仅用于面板读取，来源与密钥隔离由缓存按实际仓库配置检查，不参与同步写入。
var cloudRepoSnapshotCache dejavu.CloudSnapshotCache
