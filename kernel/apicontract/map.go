package apicontract

// MapRuntime 声明内置 OpenFreeMap，不包含服务配置、密钥或安全码。
type MapRuntime struct {
	Provider string `json:"provider" api:"enum=openfreemap"`
}
