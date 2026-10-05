$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$scriptPath = Join-Path $PSScriptRoot '..\scripts\validate-windows-install.ps1'
$parseTokens = $null
$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($scriptPath, [ref]$parseTokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw 'Installer validator did not parse.' }
foreach ($name in @('Get-FullPathWithin', 'Get-Registration')) {
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
