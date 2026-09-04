terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.0"
    }
    null = {
      source  = "hashicorp/null"
      version = "~> 3.0"
    }
  }
}

provider "null" {}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project = var.project
    }
  }
}

locals {
  # S3 key prefix that triggers the EventBridge rule:
  #   {s3_prefix}/originals/{album}/{filename}
  #   e.g.  bin/originals/2025-switzerland/photo.jpg
  originals_prefix = "${var.s3_prefix}/originals/"
}

# ── S3 Bucket ──────────────────────────────────────────────────────────────────
# The bucket already exists — import it before applying:
#   terraform import aws_s3_bucket.photos joshs-photo-storage

resource "aws_s3_bucket" "photos" {
  bucket = var.bucket_name
}

resource "aws_s3_bucket_cors_configuration" "photos" {
  bucket = aws_s3_bucket.photos.id

  cors_rule {
    allowed_headers = ["*"]
    allowed_methods = ["GET"]
    allowed_origins = ["*"]
    max_age_seconds = 3600
  }
}

# Keep originals private; derived/ is served publicly via bucket policy below.
resource "aws_s3_bucket_public_access_block" "photos" {
  bucket = aws_s3_bucket.photos.id

  block_public_acls       = true
  block_public_policy     = false
  ignore_public_acls      = true
  restrict_public_buckets = false
}

resource "aws_s3_bucket_policy" "photos" {
  bucket     = aws_s3_bucket.photos.id
  depends_on = [aws_s3_bucket_public_access_block.photos]

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        # Public read on derived sizes only (thumb / medium / large)
        Sid       = "PublicReadDerived"
        Effect    = "Allow"
        Principal = "*"
        Action    = "s3:GetObject"
        Resource  = "${aws_s3_bucket.photos.arn}/*/derived/*"
      },
      {
        Sid       = "PublicReadManifest"
        Effect    = "Allow"
        Principal = "*"
        Action    = "s3:GetObject"
        Resource  = "${aws_s3_bucket.photos.arn}/*/manifest.json"
      },
      {
        Sid       = "PublicReadCollections"
        Effect    = "Allow"
        Principal = "*"
        Action    = "s3:GetObject"
        Resource  = "${aws_s3_bucket.photos.arn}/*/collections.json"
      }
    ]
  })
}

# ── Step Functions State Machine ───────────────────────────────────────────────

data "aws_caller_identity" "current" {}

data "aws_secretsmanager_secret_version" "openai_api_key" {
  secret_id = "josh-portfolio/openai-api-key"
}

resource "aws_iam_role" "sfn" {
  name = "${var.project}-photo-pipeline-sfn"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "states.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "sfn" {
  role = aws_iam_role.sfn.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid      = "InvokeLambda"
      Effect   = "Allow"
      Action   = "lambda:InvokeFunction"
      Resource = aws_lambda_function.photo_processor.arn
    }]
  })
}

resource "aws_sfn_state_machine" "photo_pipeline" {
  name     = "${var.project}-photo-pipeline"
  role_arn = aws_iam_role.sfn.arn

  definition = jsonencode({
    Comment = "Photo processing pipeline: resize → colors → describe → embed"
    StartAt = "CheckSource"
    States = {
      # Route based on whether this is an S3 event or an admin retrigger
      CheckSource = {
        Type = "Choice"
        Choices = [{
          Variable      = "$.detail"
          IsPresent     = true
          Next          = "Prepare"
        }]
        Default = "RouteToStep"
      }

      # Parse S3 event into pipeline params
      Prepare = {
        Type       = "Task"
        Resource   = aws_lambda_function.photo_processor.arn
        Parameters = {
          step          = "prepare"
          "detail.$"    = "$.detail"
        }
        ResultPath = "$"
        Next       = "Resize"
        Retry      = [{ ErrorEquals = ["States.ALL"], IntervalSeconds = 5, MaxAttempts = 4, BackoffRate = 2 }]
      }

      # Admin retrigger: skip to the requested step
      RouteToStep = {
        Type = "Choice"
        Choices = [
          { Variable = "$.startAt", StringEquals = "resize",   Next = "Resize" },
          { Variable = "$.startAt", StringEquals = "colors",   Next = "Colors" },
          { Variable = "$.startAt", StringEquals = "describe", Next = "Describe" },
          { Variable = "$.startAt", StringEquals = "embed",    Next = "Embed" }
        ]
        Default = "Resize"
      }

      Resize = {
        Type       = "Task"
        Resource   = aws_lambda_function.photo_processor.arn
        Parameters = {
          step           = "resize"
          "bucket.$"     = "$.bucket"
          "prefix.$"     = "$.prefix"
          "album.$"      = "$.album"
          "bname.$"      = "$.bname"
          "filename.$"   = "$.filename"
        }
        ResultPath = "$.resizeResult"
        Next       = "Colors"
        Retry      = [{ ErrorEquals = ["States.ALL"], IntervalSeconds = 5, MaxAttempts = 4, BackoffRate = 2 }]
        Catch      = [{ ErrorEquals = ["States.ALL"], ResultPath = "$.resizeError", Next = "Colors" }]
      }

      Colors = {
        Type       = "Task"
        Resource   = aws_lambda_function.photo_processor.arn
        Parameters = {
          step           = "colors"
          "bucket.$"     = "$.bucket"
          "prefix.$"     = "$.prefix"
          "album.$"      = "$.album"
          "bname.$"      = "$.bname"
          "filename.$"   = "$.filename"
        }
        ResultPath = "$.colorsResult"
        Next       = "Describe"
        Retry      = [{ ErrorEquals = ["States.ALL"], IntervalSeconds = 5, MaxAttempts = 4, BackoffRate = 2 }]
        Catch      = [{ ErrorEquals = ["States.ALL"], ResultPath = "$.colorsError", Next = "Describe" }]
      }

      Describe = {
        Type       = "Task"
        Resource   = aws_lambda_function.photo_processor.arn
        Parameters = {
          step           = "describe"
          "bucket.$"     = "$.bucket"
          "prefix.$"     = "$.prefix"
          "album.$"      = "$.album"
          "bname.$"      = "$.bname"
          "filename.$"   = "$.filename"
        }
        ResultPath = "$.describeResult"
        Next       = "Embed"
        Retry      = [{ ErrorEquals = ["States.ALL"], IntervalSeconds = 5, MaxAttempts = 4, BackoffRate = 2 }]
        Catch      = [{ ErrorEquals = ["States.ALL"], ResultPath = "$.describeError", Next = "Embed" }]
      }

      Embed = {
        Type       = "Task"
        Resource   = aws_lambda_function.photo_processor.arn
        Parameters = {
          step           = "embed"
          "bucket.$"     = "$.bucket"
          "prefix.$"     = "$.prefix"
          "album.$"      = "$.album"
          "bname.$"      = "$.bname"
          "filename.$"   = "$.filename"
        }
        ResultPath = "$.embedResult"
        End        = true
        Retry      = [{ ErrorEquals = ["States.ALL"], IntervalSeconds = 5, MaxAttempts = 4, BackoffRate = 2 }]
      }
    }
  })
}

# ── EventBridge: S3 upload → Step Functions ───────────────────────────────────

# S3 must send events to EventBridge for this to work
resource "aws_s3_bucket_notification" "eventbridge" {
  bucket      = aws_s3_bucket.photos.id
  eventbridge = true
}

resource "aws_iam_role" "eventbridge_sfn" {
  name = "${var.project}-eventbridge-sfn"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "events.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "eventbridge_sfn" {
  role = aws_iam_role.eventbridge_sfn.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid      = "StartExecution"
      Effect   = "Allow"
      Action   = "states:StartExecution"
      Resource = aws_sfn_state_machine.photo_pipeline.arn
    }]
  })
}

resource "aws_cloudwatch_event_rule" "s3_originals_upload" {
  name = "${var.project}-s3-originals-upload"

  event_pattern = jsonencode({
    source      = ["aws.s3"]
    detail-type = ["Object Created"]
    detail = {
      bucket = { name = [var.bucket_name] }
      object = { key  = [{ prefix = "${var.s3_prefix}/originals/" }] }
    }
  })
}

resource "aws_cloudwatch_event_target" "sfn" {
  rule     = aws_cloudwatch_event_rule.s3_originals_upload.name
  arn      = aws_sfn_state_machine.photo_pipeline.arn
  role_arn = aws_iam_role.eventbridge_sfn.arn
}

# ── Lambda IAM ────────────────────────────────────────────────────────────────
resource "aws_iam_role" "photo_processor" {
  name = "${var.project}-photo-processor"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect    = "Allow"
        Principal = { Service = "lambda.amazonaws.com" }
        Action    = "sts:AssumeRole"
      }
    ]
  })
}

resource "aws_iam_role_policy" "photo_processor" {
  role = aws_iam_role.photo_processor.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "Logs"
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]
        Resource = "arn:aws:logs:${var.aws_region}:*:*"
      },
      {
        Sid    = "ListBucket"
        Effect = "Allow"
        Action = ["s3:ListBucket"]
        Resource = aws_s3_bucket.photos.arn
      },
      {
        Sid    = "ReadOriginals"
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:HeadObject"
        ]
        Resource = "${aws_s3_bucket.photos.arn}/${local.originals_prefix}*"
      },
      {
        Sid    = "WriteDerived"
        Effect = "Allow"
        Action = ["s3:PutObject"]
        Resource = "${aws_s3_bucket.photos.arn}/*/derived/*"
      },
      {
        Sid    = "ReadWriteManifest"
        Effect = "Allow"
        Action = ["s3:GetObject", "s3:PutObject"]
        Resource = "${aws_s3_bucket.photos.arn}/*/manifest.json"
      },
      {
        Sid    = "ReadCollections"
        Effect = "Allow"
        Action = ["s3:GetObject"]
        Resource = "${aws_s3_bucket.photos.arn}/*/collections.json"
      },
      {
        Sid    = "ReadWriteEmbeddings"
        Effect = "Allow"
        Action = ["s3:GetObject", "s3:PutObject"]
        Resource = "${aws_s3_bucket.photos.arn}/*/private/embeddings.json"
      },
      {
        Sid    = "InvokeBedrock"
        Effect = "Allow"
        Action = ["bedrock:InvokeModel"]
        Resource = [
          "arn:aws:bedrock:${var.aws_region}:${data.aws_caller_identity.current.account_id}:inference-profile/${var.claude_model}",
          "arn:aws:bedrock:*::foundation-model/anthropic.claude-3-haiku-20240307-v1:0"
        ]
      }
    ]
  })
}

# ── Lambda build ──────────────────────────────────────────────────────────────
# Install sharp for linux/x64 (Lambda runtime) before packaging.
# Re-runs whenever index.js or package.json changes.
resource "null_resource" "lambda_build" {
  triggers = {
    index_hash   = filesha256("${path.module}/../lambdas/photo-processor/index.js")
    package_hash = filesha256("${path.module}/../lambdas/photo-processor/package.json")
  }

  provisioner "local-exec" {
    command = "cd ${path.module}/../lambdas/photo-processor && rm -rf node_modules && npm install --os=linux --cpu=x64 --libc=glibc"
  }
}

# ── Lambda function ───────────────────────────────────────────────────────────
data "archive_file" "lambda" {
  depends_on  = [null_resource.lambda_build]
  type        = "zip"
  source_dir  = "${path.module}/../lambdas/photo-processor"
  output_path = "${path.module}/../lambdas/photo-processor/function.zip"
  excludes    = ["function.zip"]
}

resource "aws_lambda_function" "photo_processor" {
  filename         = data.archive_file.lambda.output_path
  source_code_hash = data.archive_file.lambda.output_base64sha256
  function_name    = "${var.project}-photo-processor"
  role             = aws_iam_role.photo_processor.arn
  handler          = "index.handler"
  runtime          = "nodejs20.x"
  timeout          = 180
  memory_size      = 512

  environment {
    variables = {
      BUCKET_NAME        = var.bucket_name
      AWS_ACCOUNT_REGION = var.aws_region
      OPENAI_API_KEY     = data.aws_secretsmanager_secret_version.openai_api_key.secret_string
    }
  }
}

resource "aws_cloudwatch_log_group" "photo_processor" {
  name              = "/aws/lambda/${aws_lambda_function.photo_processor.function_name}"
  retention_in_days = 14
}

# ── Photo Search Lambda ────────────────────────────────────────────────────────

resource "aws_iam_role" "photo_search" {
  name = "${var.project}-photo-search"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "photo_search" {
  role = aws_iam_role.photo_search.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "Logs"
        Effect = "Allow"
        Action = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "arn:aws:logs:${var.aws_region}:*:*"
      },
      {
        Sid    = "ReadManifest"
        Effect = "Allow"
        Action = ["s3:GetObject"]
        Resource = "${aws_s3_bucket.photos.arn}/*/manifest.json"
      },
      {
        Sid    = "ReadEmbeddings"
        Effect = "Allow"
        Action = ["s3:GetObject"]
        Resource = "${aws_s3_bucket.photos.arn}/*/private/embeddings.json"
      },
    ]
  })
}

resource "null_resource" "lambda_search_build" {
  triggers = {
    index_hash   = filesha256("${path.module}/../lambdas/photo-search/index.js")
    package_hash = filesha256("${path.module}/../lambdas/photo-search/package.json")
  }

  provisioner "local-exec" {
    command = "cd ${path.module}/../lambdas/photo-search && rm -rf node_modules && npm install"
  }
}

data "archive_file" "lambda_search" {
  depends_on  = [null_resource.lambda_search_build]
  type        = "zip"
  source_dir  = "${path.module}/../lambdas/photo-search"
  output_path = "${path.module}/../lambdas/photo-search/function.zip"
  excludes    = ["function.zip"]
}

resource "aws_lambda_function" "photo_search" {
  filename         = data.archive_file.lambda_search.output_path
  source_code_hash = data.archive_file.lambda_search.output_base64sha256
  function_name    = "${var.project}-photo-search"
  role             = aws_iam_role.photo_search.arn
  handler          = "index.handler"
  runtime          = "nodejs20.x"
  timeout          = 30
  memory_size      = 256

  environment {
    variables = {
      BUCKET_NAME    = var.bucket_name
      S3_PREFIX      = var.s3_prefix
      OPENAI_API_KEY = data.aws_secretsmanager_secret_version.openai_api_key.secret_string
    }
  }

  depends_on = [aws_iam_role_policy.photo_search]
}

resource "aws_cloudwatch_log_group" "photo_search" {
  name              = "/aws/lambda/${aws_lambda_function.photo_search.function_name}"
  retention_in_days = 14
}

resource "aws_apigatewayv2_api" "photo_search" {
  name          = "${var.project}-photo-search"
  protocol_type = "HTTP"

  cors_configuration {
    allow_origins = ["https://jamarcelin.github.io"]
    allow_methods = ["POST", "OPTIONS"]
    allow_headers = ["Content-Type"]
    max_age       = 86400
  }
}

resource "aws_apigatewayv2_integration" "photo_search" {
  api_id                 = aws_apigatewayv2_api.photo_search.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.photo_search.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "photo_search" {
  api_id    = aws_apigatewayv2_api.photo_search.id
  route_key = "POST /"
  target    = "integrations/${aws_apigatewayv2_integration.photo_search.id}"
}

resource "aws_apigatewayv2_stage" "photo_search" {
  api_id      = aws_apigatewayv2_api.photo_search.id
  name        = "$default"
  auto_deploy = true
}

resource "aws_lambda_permission" "photo_search_apigw" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.photo_search.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.photo_search.execution_arn}/*/*"
}
