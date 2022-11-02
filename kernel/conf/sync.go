// SiYuan - Build Your Eternal Digital Garden
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

package conf

type Sync struct {
	CloudName           string `json:"cloudName"`           // 云端同步目录名称
	Enabled             bool   `json:"enabled"`             // 是否开启同步
	Mode                int    `json:"mode"`                // 同步模式，0：未设置（为兼容已有配置，initConf 函数中会转换为 1），1：自动，2：手动 https://github.com/siyuan-note/siyuan/issues/5089
	Synced              int64  `json:"synced"`              // 最近同步时间
	Stat                string `json:"stat"`                // 最近同步统计信息
	GenerateConflictDoc bool   `json:"generateConflictDoc"` // 云端同步冲突时是否生成冲突文档
	Provider            int    `json:"provider"`            // 云端存储服务提供者，0：思源官方，1：第三方对象存储服务
	OSS                 *OSS   `json:"oss"`                 // 对象存储服务配置
}

func NewSync() *Sync {
	return &Sync{
		CloudName:           "main",
		Enabled:             false,
		Mode:                1,
		GenerateConflictDoc: false,
		Provider:            0,
	}
}

type OSS struct {
	Endpoint  string `json:"endpoint"`  // 服务端点
	AccessKey string `json:"accessKey"` // Access Key
	SecretKey string `json:"secretKey"` // Secret Key
	Regin     string `json:"regin"`     // 存储区域
	Bucket    string `json:"bucket"`    // 存储空间
}
