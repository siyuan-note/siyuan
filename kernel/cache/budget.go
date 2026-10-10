package cache

const (
	// AdmissionCounters 为约一千个常用键保留十倍频率计数器，不限制缓存条数。
	AdmissionCounters = 10000
	// DefaultMaxCostBytes 是文档、属性和属性视图缓存各自的字节预算。
	DefaultMaxCostBytes = 200 * 1024 * 1024
	// LookupMaxCostBytes 是块查询和虚拟引用缓存各自的字节预算。
	LookupMaxCostBytes = 10 * 1024 * 1024
)
