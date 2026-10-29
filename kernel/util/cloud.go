// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

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
	chinaServer            = "https://siyuan-sync.b3logfile.com"    // 中国大陆云端服务地址，阿里云负载均衡，用于接口（数据同步文件上传、下载会走七牛云 OSS ChinaSyncServer）
	chinaWebSocketServer   = "wss://siyuan-sync.b3logfile.com"      // 中国大陆云端 WebSocket 服务地址，阿里云负载均衡
	chinaSyncServer        = "https://siyuan-data.b3logfile.com/"   // 中国大陆云端数据同步服务地址，七牛云 OSS，用于数据同步文件上传、下载
	chinaCloudAssetsServer = "https://assets.b3logfile.com/siyuan/" // 中国大陆云端图床服务地址，用于导出预览模式下订阅会员渲染图床
	chinaAccountServer     = "https://ld246.com"                    // 中国大陆链滴服务地址，用于账号登录、分享发布帖子
	chinaForumAssetsServer = "https://b3logfile.com/file/"          // 中国大陆链滴图床服务地址，用于发布文章到社区

	northAmericaServer            = "https://siyuan-cloud.liuyun.io"   // 北美云端服务地址，Cloudflare，用于接口（数据同步文件上传、下载会走七牛云 OSS northAmericaSyncServer）
	northAmericaWebSocketServer   = "wss://siyuan-cloud.liuyun.io"     // 北美云端 WebSocket 服务地址，Cloudflare，
	northAmericaSyncServer        = "https://siyuan-data.liuyun.io/"   // 北美云端数据同步服务地址，七牛云 OSS，用于数据同步文件上传、下载
	northAmericaCloudAssetsServer = "https://assets.liuyun.io/siyuan/" // 北美云端图床服务地址，用于导出预览模式下订阅会员渲染图床
	northAmericaAccountServer     = "https://liuyun.io"                // 流云服务地址，用于账号登录、分享发布帖子
	northAmericaForumAssetsServer = "https://assets.liuyun.io/file/"   // 北美云端图床服务地址，用于发布文章到社区

	BazaarStatServer = "https://bazaar.b3logfile.com" // 集市包统计服务地址，七牛云，全球 CDN
	BazaarOSSServer  = "https://oss.b3logfile.com"    // 云端对象存储地址，七牛云，仅用于读取集市包，全球 CDN
)
