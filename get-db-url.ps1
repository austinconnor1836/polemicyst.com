$taskDef = & "C:\Program Files\Amazon\AWSCLIV2\aws" ecs describe-task-definition --task-definition polemicyst-prod-web --region us-east-1 --output json | ConvertFrom-Json
$envVars = $taskDef.taskDefinition.containerDefinitions[0].environment
$dbUrl = ($envVars | Where-Object { $_.name -eq "DATABASE_URL" }).value
Write-Host $dbUrl
