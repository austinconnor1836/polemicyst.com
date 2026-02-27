#!/bin/bash
# Run Prisma migrations on RDS via ECS task
#
# This script runs a one-time ECS task using the web app container
# and overrides the command to run Prisma migrations

set -e

CLUSTER="polemicyst-cluster"
TASK_DEF="polemicyst-web"
SUBNETS=$(aws ec2 describe-subnets --filters "Name=tag:Name,Values=polemicyst-private-*" --query 'Subnets[*].SubnetId' --output text | tr '\t' ',')
SECURITY_GROUP=$(aws ec2 describe-security-groups --filters "Name=tag:Name,Values=polemicyst-ecs-tasks-sg" --query 'SecurityGroups[0].GroupId' --output text)

echo "Running Prisma migrations on RDS..."
echo "Cluster: $CLUSTER"
echo "Task Definition: $TASK_DEF"
echo "Subnets: $SUBNETS"
echo "Security Group: $SECURITY_GROUP"

aws ecs run-task \
  --cluster "$CLUSTER" \
  --task-definition "$TASK_DEF" \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[$SUBNETS],securityGroups=[$SECURITY_GROUP],assignPublicIp=DISABLED}" \
  --overrides '{
    "containerOverrides": [{
      "name": "web",
      "command": ["npx", "prisma", "migrate", "deploy"]
    }]
  }' \
  --query 'tasks[0].taskArn' \
  --output text

echo "Migration task started. Check AWS Console or logs to verify completion."
