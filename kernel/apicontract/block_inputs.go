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
