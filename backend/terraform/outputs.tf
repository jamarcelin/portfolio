output "bucket_name" {
  value = aws_s3_bucket.photos.bucket
}

output "state_machine_arn" {
  description = "ARN of the photo processing Step Functions state machine"
  value       = aws_sfn_state_machine.photo_pipeline.arn
}

output "lambda_function_name" {
  value = aws_lambda_function.photo_processor.function_name
}

output "lambda_function_arn" {
  value = aws_lambda_function.photo_processor.arn
}

output "originals_prefix" {
  description = "S3 prefix that triggers the EventBridge rule"
  value       = local.originals_prefix
}

output "search_function_url" {
  description = "API Gateway URL for the photo search endpoint"
  value       = aws_apigatewayv2_stage.photo_search.invoke_url
}
