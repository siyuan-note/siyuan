package conf

import "testing"

func TestSyncProviderRequiredFields(t *testing.T) {
	values := map[string]string{"endpoint": "example.com", "accessKey": "key", "secretKey": "secret", "bucket": "notes", "region": "auto"}
	for _, provider := range []int{ProviderS3, ProviderWebDAV, ProviderLocal} {
		if MissingSyncProviderField(provider, values) {
			t.Fatal("complete configuration was rejected")
		}
		for _, key := range SyncProviderRequiredFields(provider) {
			original := values[key]
			values[key] = " \t\n "
			if !MissingSyncProviderField(provider, values) {
				t.Fatalf("provider %d did not enforce advertised field %s", provider, key)
			}
			values[key] = original
		}
	}
	if MissingSyncProviderField(ProviderWebDAV, map[string]string{"endpoint": "example.com"}) {
		t.Fatal("anonymous WebDAV was rejected")
	}
	if len(SyncProviderRequiredFields(ProviderSiYuan)) != 0 {
		t.Fatal("official storage advertises third-party fields")
	}
}

func TestS3EndpointIncludesBucket(t *testing.T) {
	for _, tc := range []struct {
		endpoint, bucket string
		want             bool
	}{
		{"https://notes.storage.example", "notes", true},
		{" NOTES.storage.example/path ", " Notes ", true},
		{"http(s)://notes.storage.example", "notes", true},
		{"http://notes.storage.example:9000", "notes", true},
		{"https://my.notes.storage.example", "my.notes", true},
		{"https://notebook.storage.example", "notes", false},
		{"https://storage.example/notes", "notes", false},
		{"https://notes", "notes", false},
		{"https://storage.example?notes.storage.example", "notes", false},
		{"ftp://notes.storage.example", "notes", false},
		{"https://bad host", "bad", false},
		{"", "notes", false},
		{"https://notes.storage.example", "", false},
	} {
		if got := S3EndpointIncludesBucket(tc.endpoint, tc.bucket); got != tc.want {
			t.Errorf("%q, %q: got %v, want %v", tc.endpoint, tc.bucket, got, tc.want)
		}
	}
}
