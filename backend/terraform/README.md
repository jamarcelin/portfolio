# Infrastructure — Terraform

Manages the AWS infrastructure backing the photo storage pipeline.

## Architecture

```
Admin tool (local)
  └── uploads original file
        └── s3://joshs-photo-storage/bin/originals/2025-switzerland/photo.jpg
              │
              │  S3 ObjectCreated event  (prefix filter: bin/originals/)
              ▼
        SQS queue: josh-portfolio-photo-processing
              │
              │  event source mapping  (batch_size = 1)
              ▼
        Lambda: josh-portfolio-photo-processor
              │
              ├── parses album name from key path
              └── TODO: generate derived sizes, update manifest, etc.
```

Failed messages retry 3 times then land in the dead-letter queue (`-dlq`) where they are retained for 14 days.

## S3 key structure

```
{s3_prefix}/
├── originals/
│   └── {album}/          ← e.g. 2025-switzerland
│       └── photo.jpg     ← original, untouched, private
└── derived/
    ├── thumb/
    │   └── photo.jpg     ← 400 × 400 square crop, public
    ├── medium/
    │   └── photo.jpg     ← 1200 px wide, natural aspect ratio, public
    └── large/
        └── photo.jpg     ← 2400 px wide, natural aspect ratio, public
```

`originals/` is **private**. Only `derived/` is publicly readable via the bucket policy.

## Resources

| Resource | Name | Purpose |
|---|---|---|
| `aws_s3_bucket` | `joshs-photo-storage` | Photo storage |
| `aws_s3_bucket_cors_configuration` | — | Allow GET from any origin |
| `aws_s3_bucket_public_access_block` | — | Block public ACLs, allow bucket policy |
| `aws_s3_bucket_policy` | — | Public read on `*/derived/*` only |
| `aws_s3_bucket_notification` | `originals-to-sqs` | Fires on `s3:ObjectCreated:*` under `bin/originals/` |
| `aws_sqs_queue` | `josh-portfolio-photo-processing` | Main processing queue |
| `aws_sqs_queue` | `josh-portfolio-photo-processing-dlq` | Dead-letter queue (14-day retention) |
| `aws_sqs_queue_policy` | — | Allows S3 to publish to the queue |
| `aws_iam_role` | `josh-portfolio-photo-processor` | Lambda execution role |
| `aws_iam_role_policy` | — | CloudWatch Logs, SQS consume, S3 read originals + write derived |
| `aws_lambda_function` | `josh-portfolio-photo-processor` | Processes new originals |
| `aws_cloudwatch_log_group` | `/aws/lambda/josh-portfolio-photo-processor` | 14-day log retention |
| `aws_lambda_event_source_mapping` | — | Wires SQS → Lambda, batch size 1 |

## Files

```
backend/
├── lambdas/
│   ├── photo-processor/
│   │   └── index.js      — ingest/resize/embed Lambda handler (Node.js 20)
│   └── photo-search/
│       └── index.js      — search/rank Lambda handler (Node.js 20)
└── terraform/
    ├── main.tf           — all resources
    ├── variables.tf      — inputs
    └── outputs.tf        — useful ARNs / URLs after apply
```

## Variables

| Variable | Default | Description |
|---|---|---|
| `aws_region` | `us-east-1` | AWS region for all resources |
| `bucket_name` | `joshs-photo-storage` | S3 bucket name |
| `s3_prefix` | `bin` | Top-level prefix inside the bucket |
| `project` | `josh-portfolio` | Tag and name prefix for all resources |

## Prerequisites

- [Terraform](https://developer.hashicorp.com/terraform/install) ≥ 1.5
- AWS credentials configured (`aws configure` or environment variables)
- The S3 bucket `joshs-photo-storage` already exists and must be imported before the first apply (see below)

## First-time setup

The S3 bucket already exists in AWS, so import it before letting Terraform manage it — otherwise `terraform apply` will fail trying to create a bucket that already exists.

```bash
cd terraform
terraform init
terraform import aws_s3_bucket.photos joshs-photo-storage
terraform plan
terraform apply
```

Subsequent deploys (e.g. after updating the Lambda):

```bash
terraform plan
terraform apply
```

## Deploying Lambda changes

Lambda code lives in:
- `backend/lambdas/photo-processor/index.js`
- `backend/lambdas/photo-search/index.js`

Terraform uses the `archive` provider to zip each Lambda automatically. Edit either handler and run `terraform apply`; `source_code_hash` ensures Lambda updates only when code changes.

```bash
# Edit one of:
#   backend/lambdas/photo-processor/index.js
#   backend/lambdas/photo-search/index.js
terraform apply
```

## Album naming convention

Album directory names in S3 should follow `YYYY-location` kebab-case:

```
2025-switzerland
2025-new-york
2024-iceland
```

The Lambda parses the key `{prefix}/originals/{album}/{filename}` and extracts the album name for downstream processing.

## IAM permissions summary

The Lambda role has the minimum permissions needed:

| Permission | Scope |
|---|---|
| `logs:CreateLogGroup/Stream`, `logs:PutLogEvents` | All CloudWatch Logs |
| `sqs:ReceiveMessage`, `DeleteMessage`, `GetQueueAttributes` | Processing queue only |
| `s3:GetObject`, `s3:HeadObject` | `bin/originals/*` only |
| `s3:PutObject` | `*/derived/*` only |

## Useful commands

```bash
# See what will change
terraform plan

# Apply changes
terraform apply

# View outputs (queue URL, Lambda ARN, etc.)
terraform output

# Tail Lambda logs
aws logs tail /aws/lambda/josh-portfolio-photo-processor --follow

# Inspect the dead-letter queue
aws sqs get-queue-attributes \
  --queue-url $(terraform output -raw sqs_dlq_url) \
  --attribute-names ApproximateNumberOfMessages
```
