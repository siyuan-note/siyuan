package apicontract

// WorkspaceStorageData 统计当前内核工作空间已落盘的普通文件字节数，不包含目录分配空间或链接目标。
// 该接口无需请求体，要求登录和管理员权限，允许只读模式，不触发资源下载或加密内容读取。
// 每次请求重新扫描，并发请求共享进行中的扫描；扫描不是文件系统快照，期间的写入可能影响结果。
// 扫描期间已删除的子文件或子目录不计入；根目录丢失、权限错误等仍返回失败。
// 读取失败或扫描超时返回 code=-1、data=null，不返回不完整的容量结果。
type WorkspaceStorageData struct {
	TotalSize    int64                   `json:"totalSize"`
	AssetsSize   int64                   `json:"assetsSize"`                    // data 内各级资源目录的子集，不能重复加入总量。
	CalculatedAt int64                   `json:"calculatedAt"`                  // 扫描完成时间，Unix 毫秒。
	Directories  []WorkspaceStorageEntry `json:"directories" api:"nonnullable"` // 固定顺序：data、repo、history、temp、conf、other。
}

type WorkspaceStorageEntry struct {
	Name string `json:"name" api:"enum=data|repo|history|temp|conf|other"`
	Size int64  `json:"size"`
}
