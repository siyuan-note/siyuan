package util

// NormalizeWebTimeout 统一网页搜索和抓取的超时秒数。
func NormalizeWebTimeout(timeout int) int {
	if timeout < 1 {
		return 30
	}
	return min(timeout, 600)
}
