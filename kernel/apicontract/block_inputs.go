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

type AppendBlockRequest struct {
	Data     string `json:"data"`
	DataType string `json:"dataType" api:"trim"`
	ParentID string `json:"parentID" api:"trim"`
}

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
