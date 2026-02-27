param(
    [Parameter(Mandatory=$true)]
    [string]$OverridesFile
)

$awsCli = "C:\Program Files\Amazon\AWSCLIV2\aws"
$region = "us-east-1"
$cluster = "polemicyst-cluster"

# Get network config from running service
$serviceRaw = & $awsCli ecs describe-services --cluster $cluster --services polemicyst-prod-web --region $region --output json
$service = $serviceRaw | ConvertFrom-Json
$nc = $service.services[0].networkConfiguration.awsvpcConfiguration
$subnetsJson = ($nc.subnets | ForEach-Object { "`"$_`"" }) -join ","
$sgsJson = ($nc.securityGroups | ForEach-Object { "`"$_`"" }) -join ","
$netJson = "{`"awsvpcConfiguration`":{`"subnets`":[$subnetsJson],`"securityGroups`":[$sgsJson],`"assignPublicIp`":`"$($nc.assignPublicIp)`"}}"

$netFile = Join-Path $env:TEMP "ecs-netconfig.json"
Set-Content -Path $netFile -Value $netJson

Write-Host "Starting ECS task..."
$resultRaw = & $awsCli ecs run-task --cluster $cluster --task-definition polemicyst-prod-web --launch-type FARGATE --network-configuration "file://$netFile" --overrides "file://$OverridesFile" --region $region --output json
$result = $resultRaw | ConvertFrom-Json

if (-not $result.tasks -or $result.tasks.Count -eq 0) {
    Write-Host "Failed. Raw: $resultRaw"
    exit 1
}

$taskArn = $result.tasks[0].taskArn
$taskId = $taskArn.Split("/")[-1]
Write-Host "Task: $taskId"
Write-Host "Waiting for completion..."

& $awsCli ecs wait tasks-stopped --cluster $cluster --tasks $taskArn --region $region
Start-Sleep -Seconds 3

# Get exit code
$details = (& $awsCli ecs describe-tasks --cluster $cluster --tasks $taskArn --region $region --output json) | ConvertFrom-Json
$exitCode = $details.tasks[0].containers[0].exitCode
Write-Host "Exit code: $exitCode"

# Get logs from the task's log stream
$prefix = "ecs/polemicyst-prod-web/web/$taskId"
$logStream = & $awsCli logs describe-log-streams --log-group-name /ecs/polemicyst-prod-web --log-stream-name-prefix $prefix --region $region --query "logStreams[0].logStreamName" --output text 2>$null
if ($logStream -and $logStream -ne "None") {
    & $awsCli logs get-log-events --log-group-name /ecs/polemicyst-prod-web --log-stream-name $logStream --region $region --limit 30 --query "events[*].message" --output text
}

Remove-Item $netFile -ErrorAction SilentlyContinue
