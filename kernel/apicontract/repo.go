package apicontract

type CreateSnapshotRequest struct {
	Memo string `json:"memo" api:"optional"`
}

type CreateSnapshotData struct {
	ID      string `json:"id"`
	Created bool   `json:"created"`
}

type CheckSnapshotData struct {
	Changed bool `json:"changed"`
}

type SetSnapshotMemoRequest struct {
	ID   string `json:"id"`
	Memo string `json:"memo"`
}
