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

package util

var CurrentCloudRegion = 0

func GetCloudServer() string {
	if 0 == CurrentCloudRegion {
		return chinaServer
	}
	return northAmericaServer
}

func GetCloudWebSocketServer() string {
	if 0 == CurrentCloudRegion {
		return chinaWebSocketServer
	}
	return northAmericaWebSocketServer
}

func GetCloudSyncServer() string {
	if 0 == CurrentCloudRegion {
		return chinaSyncServer
	}
	return northAmericaSyncServer
}

func GetCloudAssetsServer() string {
	if 0 == CurrentCloudRegion {
		return chinaCloudAssetsServer
	}
	return northAmericaCloudAssetsServer
}

func GetCloudAccountServer() string {
	if 0 == CurrentCloudRegion {
		return chinaAccountServer
	}
	return northAmericaAccountServer
}

func GetCloudForumAssetsServer() string {
	if 0 == CurrentCloudRegion {
		return chinaForumAssetsServer
	}
	return northAmericaForumAssetsServer
}

const (
	chinaServer            = "https://siyuan-sync.b3logfile.com"    // 中国大陆云端服务地址，阿里云负载均衡，用于接口，数据同步文件上传、下载会走七牛云 OSS ChinaSyncServer
	chinaWebSocketServer   = "wss://siyuan-sync.b3logfile.com"      // 中国大陆云端服务地址，阿里云负载均衡，用于接口，数据同步文件上传、下载会走七牛云 OSS ChinaSyncServer
	chinaSyncServer        = "https://siyuan-data.b3logfile.com/"   // 中国大陆云端数据同步服务地址，七牛云 OSS，用于数据同步文件上传、下载
	chinaCloudAssetsServer = "https://assets.b3logfile.com/siyuan/" // 中国大陆云端图床服务地址，用于导出预览模式下订阅会员渲染图床
	chinaAccountServer     = "https://ld246.com"                    // 中国大陆链滴服务地址，用于账号登录、分享发布帖子
	chinaForumAssetsServer = "https://b3logfile.com/file/"          // 中国大陆链滴图床服务地址，用于发布文章到社区

	northAmericaServer            = "https://siyuan-cloud.liuyun.io"   // 北美云端服务地址，Cloudflare
	northAmericaWebSocketServer   = "wss://siyuan-cloud.liuyun.io"     // 北美云端服务地址，Cloudflare，用于接口，数据同步文件上传、下载会走七牛云 OSS ChinaSyncServer
	northAmericaSyncServer        = "https://siyuan-data.liuyun.io/"   // 北美云端数据同步服务地址，七牛云 OSS，用于数据同步文件上传、下载
	northAmericaCloudAssetsServer = "https://assets.liuyun.io/siyuan/" // 北美云端图床服务地址，用于导出预览模式下订阅会员渲染图床
	northAmericaAccountServer     = "https://liuyun.io"                // 流云服务地址，用于账号登录、分享发布帖子
	northAmericaForumAssetsServer = "https://assets.liuyun.io/file/"   // 北美云端图床服务地址，用于发布文章到社区

	BazaarStatServer = "http://bazaar.b3logfile.com" // 集市包统计服务地址，直接对接 Bucket 没有 CDN
	BazaarOSSServer  = "https://oss.b3logfile.com"   // 云端对象存储地址，七牛云，仅用于读取集市包，全球 CDN
)
