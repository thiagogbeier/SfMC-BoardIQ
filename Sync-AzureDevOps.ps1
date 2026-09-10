<#
  Sync-AzureDevOps.ps1
  Pulls Azure DevOps work items into data\store.json for every client that has
  adoOrg + adoProject filled in. ADO items are merged (not duplicated) using the
  key ado:<org>/<project>/<id>, and are marked source="ado" so the UI keeps them
  read-only except for state/tags.

  Usage:  .\Sync-AzureDevOps.ps1
  Auth:   uses your current `az login` session (no PAT required).
#>
[CmdletBinding()]
param(
  [string] $StorePath,
  [switch] $KeepLocalState   # don't let ADO overwrite a state you changed locally
)

$ErrorActionPreference = 'Stop'
$root = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Definition }
if (-not $StorePath) { $StorePath = Join-Path $root 'data\store.json' }
if (-not (Test-Path $StorePath)) { throw "Store not found: $StorePath" }

$adoResource = '499b84ac-1321-427f-aa17-267ca6975798'
$token = az account get-access-token --resource $adoResource --query accessToken -o tsv
if (-not $token) { throw "Could not get an Azure DevOps token. Run 'az login' first." }
$headers = @{ Authorization = "Bearer $token"; 'Content-Type' = 'application/json' }

function Invoke-Ado { param($Uri, $Method = 'Get', $Body)
  if ($Body) { Invoke-RestMethod -Method $Method -Uri $Uri -Headers $headers -Body $Body }
  else       { Invoke-RestMethod -Method $Method -Uri $Uri -Headers $headers }
}

$store = [System.IO.File]::ReadAllText($StorePath, [System.Text.Encoding]::UTF8) | ConvertFrom-Json
$linked = @($store.clients | Where-Object { $_.adoOrg -and $_.adoProject })
if (-not $linked) { Write-Host "No clients are linked to an Azure DevOps project. Nothing to sync." -ForegroundColor Yellow; return }

# index existing items by ADO key
$existing = @{}
foreach ($i in $store.items) { if ($i.adoKey) { $existing[$i.adoKey] = $i } }

$kept = New-Object System.Collections.ArrayList
foreach ($i in $store.items) { if ($i.source -ne 'ado') { [void]$kept.Add($i) } }

$added = 0; $updated = 0
foreach ($c in $linked) {
  $base = "https://dev.azure.com/$($c.adoOrg)"
  $pe   = [uri]::EscapeDataString($c.adoProject)
  $wiql = @{ query = "Select [System.Id] From WorkItems Where [System.TeamProject] = '$($c.adoProject -replace "'","''")' order by [System.ChangedDate] desc" } | ConvertTo-Json
  $ids  = @((Invoke-Ado "$base/$pe/_apis/wit/wiql?api-version=7.1" -Method Post -Body $wiql).workItems |
            ForEach-Object { $_.id } | Where-Object { $_ -ne $null })
  Write-Host ("  {0,-46} {1,4} ADO items" -f $c.name, $ids.Count)
  if (-not $ids.Count) { continue }

  $batch = @()
  for ($n = 0; $n -lt $ids.Count; $n += 190) {
    $chunk = $ids[$n..([Math]::Min($n + 189, $ids.Count - 1))]
    $body  = @{ ids = @($chunk); '$expand' = 'all' } | ConvertTo-Json
    $batch += (Invoke-Ado "$base/_apis/wit/workitemsbatch?api-version=7.1" -Method Post -Body $body).value
  }

  foreach ($wi in $batch) {
    $f   = $wi.fields
    $key = "ado:$($c.adoOrg)/$($c.adoProject)/$($wi.id)"
    $prev = $existing[$key]

    $comments = @()
    if ($f.'System.CommentCount' -gt 0) {
      try {
        $comments = @((Invoke-Ado "$base/$pe/_apis/wit/workItems/$($wi.id)/comments?api-version=7.1-preview.4").comments |
          ForEach-Object { [pscustomobject]@{ id = "c$($_.id)"; by = $_.createdBy.displayName; date = $_.createdDate; text = $_.text; html = $true } })
      } catch { Write-Warning "comments failed for $($wi.id)" }
    }

    $tags = @()
    if ($f.'System.Tags') { $tags = @($f.'System.Tags' -split ';\s*' | Where-Object { $_ }) }

    $state = $f.'System.BoardColumn'
    if (-not $state) { $state = $f.'System.State' }
    if ($KeepLocalState -and $prev) { $state = $prev.state }

    $item = [pscustomobject]@{
      id          = if ($prev) { $prev.id } else { [guid]::NewGuid().ToString('N').Substring(0, 12) }
      adoKey      = $key
      clientId    = $c.id
      source      = 'ado'
      adoId       = $wi.id
      adoUrl      = "$base/$pe/_workitems/edit/$($wi.id)"
      type        = $f.'System.WorkItemType'
      title       = $f.'System.Title'
      state       = $state
      assignedTo  = $f.'System.AssignedTo'.displayName
      priority    = $f.'Microsoft.VSTS.Common.Priority'
      storyPoints = $f.'Microsoft.VSTS.Scheduling.StoryPoints'
      risk        = $f.'Microsoft.VSTS.Common.Risk'
      valueArea   = $f.'Microsoft.VSTS.Common.ValueArea'
      tags        = $tags
      description = $f.'System.Description'
      acceptance  = $f.'Microsoft.VSTS.Common.AcceptanceCriteria'
      dueDate     = $f.'Microsoft.VSTS.Scheduling.DueDate'
      reason      = $f.'System.Reason'
      area        = $f.'System.AreaPath'
      iteration   = $f.'System.IterationPath'
      created     = $f.'System.CreatedDate'
      createdBy   = $f.'System.CreatedBy'.displayName
      changed     = $f.'System.ChangedDate'
      changedBy   = $f.'System.ChangedBy'.displayName
      clientOwner = if ($prev -and $prev.clientOwner) { $prev.clientOwner } else { $c.clientLead }
      escalatedTo      = if ($prev) { $prev.escalatedTo } else { @() }
      escalationStatus = if ($prev) { $prev.escalationStatus } else { '' }
      cssCase          = if ($prev) { $prev.cssCase } else { $false }
      cssCaseNumber    = if ($prev) { $prev.cssCaseNumber } else { '' }
      dcr              = if ($prev) { $prev.dcr } else { $false }
      dcrId            = if ($prev) { $prev.dcrId } else { '' }
      dcrStatus        = if ($prev) { $prev.dcrStatus } else { '' }
      meetingStatus    = if ($prev) { $prev.meetingStatus } else { '' }
      comments    = $comments
      order       = [int]$wi.id
      archived    = $false
    }
    if ($prev) { $updated++ } else { $added++ }
    [void]$kept.Add($item)
  }
}

# backup then write
$backupDir = Join-Path (Split-Path $StorePath) 'backups'
New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
Copy-Item $StorePath (Join-Path $backupDir ("store-{0}-presync.json" -f (Get-Date -Format 'yyyyMMdd-HHmmss')))

$store.items = $kept.ToArray()
$json = $store | ConvertTo-Json -Depth 12
[System.IO.File]::WriteAllText($StorePath, $json, (New-Object System.Text.UTF8Encoding($false)))

Write-Host "`nSynced $($linked.Count) linked client(s): $added new, $updated refreshed." -ForegroundColor Green
Write-Host "Store: $StorePath" -ForegroundColor Green
