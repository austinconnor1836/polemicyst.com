$awsCli = "C:\Program Files\Amazon\AWSCLIV2\aws"
$region = "us-east-1"
$cluster = "polemicyst-cluster"

# Get network configuration from the running service
Write-Host "Getting network configuration..."
$serviceRaw = & $awsCli ecs describe-services --cluster $cluster --services polemicyst-prod-web --region $region --output json
$service = $serviceRaw | ConvertFrom-Json
$nc = $service.services[0].networkConfiguration.awsvpcConfiguration

# Build properly quoted JSON for network config
$subnetsJson = ($nc.subnets | ForEach-Object { "`"$_`"" }) -join ","
$sgsJson = ($nc.securityGroups | ForEach-Object { "`"$_`"" }) -join ","
$netConfigJson = "{`"awsvpcConfiguration`":{`"subnets`":[$subnetsJson],`"securityGroups`":[$sgsJson],`"assignPublicIp`":`"$($nc.assignPublicIp)`"}}"

Write-Host "Network config: $netConfigJson"

# Write network config to file
$netFile = Join-Path $env:TEMP "ecs-netconfig.json"
Set-Content -Path $netFile -Value $netConfigJson

# Write overrides to file - run raw SQL via node
$overridesJson = '{"containerOverrides":[{"name":"web","command":["node","-e","const{PrismaClient}=require(String.fromCharCode(64)+\"prisma/client\");const p=new PrismaClient();p[\"$executeRawUnsafe\"](\"ALTER TABLE \\\"Account\\\" ADD COLUMN IF NOT EXISTS \\\"session_state\\\" TEXT\").then(()=>{console.log(\"Migration done\");process.exit(0)}).catch(e=>{console.error(e);process.exit(1)})"]}]}'
$overridesFile = Join-Path $env:TEMP "ecs-overrides.json"
Set-Content -Path $overridesFile -Value $overridesJson

Write-Host "Starting migration task..."
$resultRaw = & $awsCli ecs run-task `
    --cluster $cluster `
    --task-definition polemicyst-prod-web `
    --launch-type FARGATE `
    --network-configuration file://$netFile `
    --overrides file://$overridesFile `
    --region $region `
    --output json

$result = $resultRaw | ConvertFrom-Json

if ($result.failures -and $result.failures.Count -gt 0) {
    Write-Host "Failed to start task:"
    $result.failures | ForEach-Object { Write-Host $_.reason }
    exit 1
}

if (-not $result.tasks -or $result.tasks.Count -eq 0) {
    Write-Host "No task was created. Raw output:"
    Write-Host $resultRaw
    exit 1
}

$taskArn = $result.tasks[0].taskArn
Write-Host "Task started: $taskArn"
Write-Host "Waiting for task to complete (this may take 1-2 minutes)..."

& $awsCli ecs wait tasks-stopped --cluster $cluster --tasks $taskArn --region $region

$detailsRaw = & $awsCli ecs describe-tasks --cluster $cluster --tasks $taskArn --region $region --output json
$details = $detailsRaw | ConvertFrom-Json
$exitCode = $details.tasks[0].containers[0].exitCode
$reason = $details.tasks[0].stoppedReason

Write-Host "Exit code: $exitCode"
Write-Host "Stopped reason: $reason"

if ($exitCode -eq 0) {
    Write-Host "Migration completed successfully!"
} else {
    Write-Host "Migration failed. Check CloudWatch logs at /ecs/polemicyst-prod-web"
}

# Clean up
Remove-Item $netFile -ErrorAction SilentlyContinue
Remove-Item $overridesFile -ErrorAction SilentlyContinue
