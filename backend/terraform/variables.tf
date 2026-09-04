variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "bucket_name" {
  description = "S3 bucket for photo storage"
  type        = string
  default     = "joshs-photo-storage"
}

variable "s3_prefix" {
  description = "Top-level prefix inside the bucket (e.g. 'bin')"
  type        = string
  default     = "bin"
}

variable "project" {
  description = "Project tag applied to all resources"
  type        = string
  default     = "josh-portfolio"
}

variable "claude_model" {
  description = "Claude inference profile ID for photo descriptions"
  type        = string
  default     = "us.anthropic.claude-3-haiku-20240307-v1:0"
}
