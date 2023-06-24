// SiYuan - Refactor your thinking
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
	CloudName           string  `json:"cloudName"`           // 云端同步目录名称
	Enabled             bool    `json:"enabled"`             // 是否开启同步
	Perception          bool    `json:"perception"`          // 是否开启感知
	Mode                int     `json:"mode"`                // 同步模式，0：未设置（为兼容已有配置，initConf 函数中会转换为 1），1：自动，2：手动 https://github.com/siyuan-note/siyuan/issues/5089，3：完全手动 https://github.com/siyuan-note/siyuan/issues/7295
	Synced              int64   `json:"synced"`              // 最近同步时间
	Stat                string  `json:"stat"`                // 最近同步统计信息
	GenerateConflictDoc bool    `json:"generateConflictDoc"` // 云端同步冲突时是否生成冲突文档
	Provider            int     `json:"provider"`            // 云端存储服务提供者
	S3                  *S3     `json:"s3"`                  // S3 对象存储服务配置
	WebDAV              *WebDAV `json:"webdav"`              // WebDAV 服务配置
}

func NewSync() *Sync {
	return &Sync{
		CloudName:           "main",
		Enabled:             false,
		Perception:          false,
		Mode:                1,
		GenerateConflictDoc: false,
		Provider:            ProviderSiYuan,
	}
}

type S3 struct {
	Endpoint      string `json:"endpoint"`      // 服务端点
	AccessKey     string `json:"accessKey"`     // Access Key
	SecretKey     string `json:"secretKey"`     // Secret Key
	Bucket        string `json:"bucket"`        // 存储空间
	Region        string `json:"region"`        // 存储区域
	PathStyle     bool   `json:"pathStyle"`     // 是否使用路径风格
	SkipTlsVerify bool   `json:"skipTlsVerify"` // 是否跳过 TLS 验证
	Timeout       int    `json:"timeout"`       // 超时时间，单位：秒
}

type WebDAV struct {
	Endpoint      string `json:"endpoint"`      // 服务端点
	Username      string `json:"username"`      // 用户名
	Password      string `json:"password"`      // 密码
	SkipTlsVerify bool   `json:"skipTlsVerify"` // 是否跳过 TLS 验证
	Timeout       int    `json:"timeout"`       // 超时时间，单位：秒
}

const (
	ProviderSiYuan = 0 // ProviderSiYuan 为思源官方提供的云端存储服务
	ProviderS3     = 2 // ProviderS3 为 S3 协议对象存储提供的云端存储服务
	ProviderWebDAV = 3 // ProviderWebDAV 为 WebDAV 协议提供的云端存储服务
)

func ProviderToStr(provider int) string {
	switch provider {
	case ProviderSiYuan:
		return "SiYuan"
	case ProviderS3:
		return "S3"
	case ProviderWebDAV:
		return "WebDAV"
	}
	return "Unknown"
}
