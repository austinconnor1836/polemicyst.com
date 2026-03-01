#!/bin/bash
set -e

# Unset conflicting env vars to force use of ~/.aws/credentials
unset AWS_ACCESS_KEY_ID
unset AWS_SECRET_ACCESS_KEY
unset AWS_SESSION_TOKEN

# Configuration
AWS_REGION="us-east-1"
ACCOUNT_ID="343953890282"
ECR_URL="${ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"

LLM_WORKER_REPO="${ECR_URL}/polemicyst-llm-worker"
CLIP_WORKER_REPO="${ECR_URL}/polemicyst-clip-worker"

echo "🚀 Starting Deployment..."
echo "--------------------------------"
echo "Region: $AWS_REGION"
echo "Account: $ACCOUNT_ID"
echo "--------------------------------"

# 1. Login to ECR
echo "🔑 Logging into ECR..."
aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $ECR_URL

# 2. Build and Push LLM Worker
echo "--------------------------------"
echo "📦 Building LLM Worker (linux/amd64)..."
docker buildx build --platform linux/amd64 \
  -t $LLM_WORKER_REPO:latest \
  -f backend/workers/llm-worker/Dockerfile \
  backend/workers/llm-worker --push

echo "✅ LLM Worker Pushed!"

# 3. Build and Push Clip Worker
echo "--------------------------------"
echo "📦 Building Clip Worker (linux/amd64)..."
docker buildx build --platform linux/amd64 \
  -t $CLIP_WORKER_REPO:latest \
  -f backend/workers/clip-worker/Dockerfile \
  . --push

echo "✅ Clip Worker Pushed!"

# 4. Force New Deployment (Optional but recommended)
echo "--------------------------------"
echo "🔄 Updating ECS Services..."
aws ecs update-service --cluster polemicyst-cluster --service provocativeness-scorer --force-new-deployment --region $AWS_REGION > /dev/null
aws ecs update-service --cluster polemicyst-cluster --service comedic-scorer --force-new-deployment --region $AWS_REGION > /dev/null
aws ecs update-service --cluster polemicyst-cluster --service clip-worker --force-new-deployment --region $AWS_REGION > /dev/null

echo "🎉 Deployment Complete!"
