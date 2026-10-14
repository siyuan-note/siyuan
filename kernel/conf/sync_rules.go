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

// S3EndpointIncludesBucket 仅提示主机名已包含桶名，不阻止保存，也不探测云端。
func S3EndpointIncludesBucket(endpoint, bucket string) bool {
	bucket = strings.ToLower(strings.TrimSpace(bucket))
	if bucket == "" || strings.TrimSpace(endpoint) == "" {
		return false
	}
	address, err := url.Parse(util.NormalizeEndpoint(strings.TrimSpace(endpoint)))
	return err == nil && (address.Scheme == "http" || address.Scheme == "https") &&
		strings.HasPrefix(strings.ToLower(address.Hostname()), bucket+".")
}
