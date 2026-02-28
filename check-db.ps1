$awsCli = "C:\Program Files\Amazon\AWSCLIV2\aws"
$region = "us-east-1"
$cluster = "polemicyst-cluster"

# Get network config
$serviceRaw = & $awsCli ecs describe-services --cluster $cluster --services polemicyst-prod-web --region $region --output json
$service = $serviceRaw | ConvertFrom-Json
$nc = $service.services[0].networkConfiguration.awsvpcConfiguration
$subnetsJson = ($nc.subnets | ForEach-Object { "`"$_`"" }) -join ","
$sgsJson = ($nc.securityGroups | ForEach-Object { "`"$_`"" }) -join ","
$netConfigJson = "{`"awsvpcConfiguration`":{`"subnets`":[$subnetsJson],`"securityGroups`":[$sgsJson],`"assignPublicIp`":`"$($nc.assignPublicIp)`"}}"

$netFile = Join-Path $env:TEMP "ecs-netconfig.json"
Set-Content -Path $netFile -Value $netConfigJson

# Use Prisma's own introspection to list tables - much simpler
$overrides = @{
    containerOverrides = @(
        @{
            name = "web"
            command = @("node", "-e", "const{PrismaClient}=require('@prisma/client');const p=new PrismaClient();p.`$queryRawUnsafe(`"SELECT tablename FROM pg_tables WHERE schemaname='public'`").then(r=>{console.log(JSON.stringify(r,null,2));process.exit(0)}).catch(e=>{console.error(String(e));process.exit(1)})")
        }
    )
} | ConvertTo-Json -Depth 10

$overridesFile = Join-Path $env:TEMP "ecs-overrides.json"
Set-Content -Path $overridesFile -Value $overrides

Write-Host "Checking database tables..."
$resultRaw = & $awsCli ecs run-task `
    --cluster $cluster `
    --task-definition polemicyst-prod-web `
    --launch-type FARGATE `
    --network-configuration file://$netFile `
    --overrides file://$overridesFile `
    --region $region `
    --output json

$result = $resultRaw | ConvertFrom-Json
$taskArn = $result.tasks[0].taskArn
Write-Host "Task: $taskArn"
Write-Host "Waiting..."

& $awsCli ecs wait tasks-stopped --cluster $cluster --tasks $taskArn --region $region

Start-Sleep -Seconds 5

# Get logs
$logStream = & $awsCli logs describe-log-streams --log-group-name /ecs/polemicyst-prod-web --order-by LastEventTime --descending --limit 1 --region $region --query "logStreams[0].logStreamName" --output text
& $awsCli logs get-log-events --log-group-name /ecs/polemicyst-prod-web --log-stream-name $logStream --region $region --limit 30 --query "events[*].message" --output text

Remove-Item $netFile -ErrorAction SilentlyContinue
Remove-Item $overridesFile -ErrorAction SilentlyContinue
