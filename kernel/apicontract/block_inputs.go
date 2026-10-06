package apicontract

type TaskListMarkerRequest struct {
	ID     string `json:"id" api:"trim"`
	Marker string `json:"marker"`
}

type BatchTaskListMarkerRequest struct {
	Items []TaskListMarkerRequest `json:"items"`
}

type DailyNoteBlockRequest struct {
	Data     string `json:"data"`
	DataType string `json:"dataType"`
	Notebook string `json:"notebook"`
}

// AppendBlockRequest 在父块末尾追加内容，页签和脑图容器只能接收各自的项目块。
// 输入同类型容器片段时插入其直属项目，保留目标容器属性和项目 ID，非法子块由事务校验拒绝。
type AppendBlockRequest struct {
	Data     string `json:"data"`
	DataType string `json:"dataType" api:"trim"`
	ParentID string `json:"parentID" api:"trim"`
}

// PrependBlockRequest 在父块开头插入内容，页签和脑图容器片段按 AppendBlockRequest 的规则展开项目。
// 保留排队执行的响应行为，事务失败不落盘，但成功响应不代表事务已通过校验。
type PrependBlockRequest struct {
	Data     string `json:"data"`
	DataType string `json:"dataType"`
	ParentID string `json:"parentID"`
}

type BatchParentBlockRequest struct {
	Blocks []PrependBlockRequest `json:"blocks"`
}

// InsertBlockRequest 按 nextID、previousID、parentID 的顺序选择插入位置。
// 生效的 nextID 或 previousID 必须指向非文档块，未使用的定位参数不参与节点类型校验。
// parentID 指向文档时插入到文档开头；成功返回已落盘的操作，目标非法时返回 code=-1、data=null。
// 插入位置位于页签或脑图容器内时，同类型容器片段展开为直属项目，保留目标容器属性和项目 ID。
type InsertBlockRequest struct {
	Data       string `json:"data"`
	DataType   string `json:"dataType" api:"trim"`
	ParentID   string `json:"parentID" api:"optional,nullable"`
	PreviousID string `json:"previousID" api:"optional,nullable"`
	NextID     string `json:"nextID" api:"optional,nullable"`
}

type BlockInsertInput struct {
	Data       string `json:"data"`
	DataType   string `json:"dataType"`
	ParentID   string `json:"parentID" api:"optional,nullable"`
	PreviousID string `json:"previousID" api:"optional,nullable"`
	NextID     string `json:"nextID" api:"optional,nullable"`
}

type BatchInsertBlockRequest struct {
	Blocks []BlockInsertInput `json:"blocks"`
}

type UpdateBlockRequest struct {
	ID       string `json:"id" api:"trim"`
	Data     string `json:"data"`
	DataType string `json:"dataType" api:"trim"`
	LockType bool   `json:"lockType" api:"optional,nullable"`
}

type BatchUpdateBlockRequest struct {
	Blocks []UpdateBlockRequest `json:"blocks"`
}

type DeleteBlockRequest struct {
	ID string `json:"id" api:"trim"`
}
