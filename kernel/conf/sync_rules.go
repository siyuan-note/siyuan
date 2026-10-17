package conf

import (
	"net/url"
	"strings"

	"github.com/siyuan-note/siyuan/kernel/util"
)

// SyncProviderRequiredFields 是表单提示和内核保存校验共用的必填字段清单。
func SyncProviderRequiredFields(provider int) []string {
	switch provider {
	case ProviderS3:
		return []string{"endpoint", "accessKey", "secretKey", "bucket", "region"}
	case ProviderWebDAV, ProviderLocal:
		return []string{"endpoint"}
	default:
		return []string{}
	}
}

// MissingSyncProviderField 检查原始字段值，避免归一化掩盖空白输入。
func MissingSyncProviderField(provider int, values map[string]string) bool {
	for _, key := range SyncProviderRequiredFields(provider) {
		if strings.TrimSpace(values[key]) == "" {
			return true
		}
	}
	return false
}

// S3EndpointIncludesBucketOrPath 提示会让仓库对象键多出前缀的 Endpoint 写法：主机名以桶名开头、地址带路径，或桶名自身含路径。
// 该判断只用于提醒，不阻止保存，也不探测云端。
func S3EndpointIncludesBucketOrPath(endpoint, bucket string) bool {
	bucket = strings.ToLower(strings.TrimSpace(bucket))
	raw := strings.TrimSpace(endpoint)
	if "" == raw {
		return false
	}
	// 非 HTTP(S) 协议属于地址错误，由保存校验处理，不在此提示
	raw = strings.Replace(raw, "http://http(s)://", "https://", 1)
	raw = strings.Replace(raw, "http(s)://", "https://", 1)
	if strings.Contains(raw, "://") && !strings.HasPrefix(raw, "http://") && !strings.HasPrefix(raw, "https://") {
		return false
	}
	address, err := url.Parse(util.NormalizeEndpoint(raw))
	if err != nil || (address.Scheme != "http" && address.Scheme != "https") || address.Hostname() == "" {
		return false
	}
	// 地址路径会排在桶名之前，非空即可能改变对象键
	if "" != strings.Trim(address.Path, "/") {
		return true
	}
	// 桶名自带路径时，对象键同样会多出该前缀
	if strings.Contains(strings.Trim(bucket, "/"), "/") {
		return true
	}
	return "" != bucket && strings.HasPrefix(strings.ToLower(address.Hostname()), bucket+".")
}
