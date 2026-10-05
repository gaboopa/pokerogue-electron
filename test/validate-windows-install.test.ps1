$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$scriptPath = Join-Path $PSScriptRoot '..\scripts\validate-windows-install.ps1'
$parseTokens = $null
$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($scriptPath, [ref]$parseTokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw 'Installer validator did not parse.' }
foreach ($name in @('Get-FullPathWithin', 'Get-Registration', 'Invoke-SilentUninstaller')) {
  $definition = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name }, $true)
  Invoke-Expression $definition.Extent.Text
}
$productName = 'PokeRogue Offline'
$appGuid = '9ee90960-c2e1-584d-beef-77fad84b6997'
$location = Join-Path $env:LOCALAPPDATA 'Programs\PokeRogue Offline'
$registration = [pscustomobject]@{ DisplayName=$productName; RegistryPath="HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Uninstall\$appGuid"; KeyName=$appGuid; InstallLocation='' }
function Get-AppRegistrations { return $registration }
function Get-ItemProperty {
  param([string]$LiteralPath)
  if ($LiteralPath -cne "HKCU:\Software\$appGuid") { throw "Unexpected registry lookup: $LiteralPath" }
  return [pscustomobject]@{ InstallLocation=$location }
}
if ((Get-Registration).InstallLocation -cne $location) { throw 'NSIS install location was not resolved.' }
foreach ($mutation in @('identity', 'hive', 'location')) {
  $oldKey = $registration.KeyName
  $oldHive = $registration.RegistryPath
  $oldLocation = $location
  if ($mutation -eq 'identity') { $registration.KeyName='other-app' }
  if ($mutation -eq 'hive') { $registration.RegistryPath='HKEY_LOCAL_MACHINE\Software\fixture' }
  if ($mutation -eq 'location') { $location=Join-Path $env:TEMP 'outside-install-root' }
  $rejected=$false
  try { Get-Registration | Out-Null } catch { $rejected=$true }
  $registration.KeyName=$oldKey
  $registration.RegistryPath=$oldHive
  $location=$oldLocation
  if (-not $rejected) { throw "Unsafe $mutation was accepted." }
}
Write-Output 'NSIS registry lookup and install containment checks passed without accessing the registry.'

$auditRoot = [System.IO.Path]::GetFullPath((Join-Path $env:TEMP "nsis-wait-check-$([guid]::NewGuid().ToString('N'))"))
$installRoot = Join-Path $auditRoot 'installation with spaces'
New-Item -ItemType Directory -Path $installRoot | Out-Null
$uninstaller = Join-Path $installRoot 'Uninstall PokeRogue Offline.exe'
Set-Content -LiteralPath $uninstaller -Value 'inert uninstaller fixture'
function Invoke-SilentInstaller {
  param([string]$Path, [string]$AllowedRoot, [string[]]$Arguments)
  $expectedCopy = [System.IO.Path]::GetFullPath((Join-Path $auditRoot 'owned-uninstaller.exe'))
  if (-not $Path.Equals($expectedCopy, [System.StringComparison]::OrdinalIgnoreCase) -or -not $AllowedRoot.Equals($auditRoot, [System.StringComparison]::OrdinalIgnoreCase)) { throw "Uninstaller copy escaped its owned audit root: $Path (expected $expectedCopy); root $AllowedRoot (expected $auditRoot)." }
  if ((Get-FileHash -LiteralPath $Path).Hash -cne (Get-FileHash -LiteralPath $uninstaller).Hash) { throw 'Uninstaller copy changed bytes.' }
  if ($Arguments.Count -ne 2 -or $Arguments[0] -cne '/S' -or $Arguments[1] -cne "_?=$installRoot") { throw 'Direct NSIS uninstall arguments are incorrect.' }
  $script:uninstallChecked = $true
}
try {
  $script:uninstallChecked = $false
  Invoke-SilentUninstaller $uninstaller $installRoot
  if (-not $script:uninstallChecked) { throw 'The direct uninstaller was not awaited.' }
  Write-Output 'NSIS direct-copy uninstall check passed without executing an installer.'
} finally {
  # auditRoot is a freshly created, explicitly contained test directory.
  $checkedRoot = Get-FullPathWithin $auditRoot $env:TEMP
  Remove-Item -LiteralPath $checkedRoot -Recurse -Force
}
