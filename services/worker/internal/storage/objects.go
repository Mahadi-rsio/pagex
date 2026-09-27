package storage

import (
	"context"
	"fmt"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"
)

// DeleteKeys removes objects by key and reports the keys that were actually
// removed.
//
// Deletion is idempotent by nature: S3 DeleteObjects succeeds for keys that do
// not exist, so a duplicated or retried cleanup simply reports them as already
// gone. A key is only reported as deleted when the API acknowledged it, which
// is what lets the caller safely remove the matching PostgreSQL rows.
func (s *Store) DeleteKeys(ctx context.Context, keys []string) ([]string, error) {
	if len(keys) == 0 {
		return nil, nil
	}

	batchSize := s.DeleteBatch
	if batchSize < 1 {
		batchSize = 100
	}

	deleted := make([]string, 0, len(keys))
	for start := 0; start < len(keys); start += batchSize {
		end := start + batchSize
		if end > len(keys) {
			end = len(keys)
		}
		batch := keys[start:end]

		objects := make([]types.ObjectIdentifier, 0, len(batch))
		for _, key := range batch {
			objects = append(objects, types.ObjectIdentifier{Key: aws.String(key)})
		}

		out, err := s.S3.DeleteObjects(ctx, &s3.DeleteObjectsInput{
			Bucket: aws.String(s.Bucket),
			Delete: &types.Delete{Objects: objects, Quiet: aws.Bool(true)},
		})
		if err != nil {
			return deleted, fmt.Errorf("delete objects: %w", err)
		}

		failed := make(map[string]struct{})
		for _, e := range out.Errors {
			if e.Key == nil {
				continue
			}
			failed[*e.Key] = struct{}{}
		}

		for _, key := range batch {
			if _, bad := failed[key]; bad {
				continue
			}
			deleted = append(deleted, key)
		}
	}

	return deleted, nil
}

// DeleteBlobHashes removes `blobs/{hash}` objects and returns the hashes that
// are now gone from the object store.
func (s *Store) DeleteBlobHashes(ctx context.Context, hashes []string) ([]string, error) {
	if len(hashes) == 0 {
		return nil, nil
	}

	keys := make([]string, 0, len(hashes))
	for _, h := range hashes {
		keys = append(keys, BlobObjectKey(h))
	}

	deleted, err := s.DeleteKeys(ctx, keys)
	if err != nil {
		return nil, err
	}

	out := make([]string, 0, len(deleted))
	for _, key := range deleted {
		out = append(out, key[len("blobs/"):])
	}
	return out, nil
}

// DeleteManifestObjects removes `manifests/{deploymentId}.manifest.json`
// objects. A missing manifest is not an error, so this is safe to re-run.
func (s *Store) DeleteManifestObjects(ctx context.Context, deploymentIDs []string) error {
	if len(deploymentIDs) == 0 {
		return nil
	}

	keys := make([]string, 0, len(deploymentIDs))
	for _, id := range deploymentIDs {
		keys = append(keys, ManifestObjectKey(id))
	}

	if _, err := s.DeleteKeys(ctx, keys); err != nil {
		return err
	}
	return nil
}
