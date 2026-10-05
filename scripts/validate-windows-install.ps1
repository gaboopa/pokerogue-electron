[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$NewInstallerPath,
  [Parameter(Mandatory = $true)]
  [string]$ReleaseManifestPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ($env:GITHUB_ACTIONS -cne 'true') { throw 'Installer validation is restricted to GitHub Actions.' }
if ($env:RUNNER_ENVIRONMENT -cne 'github-hosted') { throw 'Installer validation requires a GitHub-hosted runner.' }
if (-not [System.OperatingSystem]::IsWindows()) { throw 'Installer validation requires Windows.' }
if ([System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture -ne [System.Runtime.InteropServices.Architecture]::X64) { throw 'Installer validation requires an x64 runner.' }
if (-not $env:RUNNER_TEMP -or -not (Test-Path -LiteralPath $env:RUNNER_TEMP -PathType Container)) { throw 'RUNNER_TEMP is missing or invalid.' }

$appId = 'com.gaboopa.pokerogueoffline'
$appGuid = '9ee90960-c2e1-584d-beef-77fad84b6997'
$productName = 'PokeRogue Offline'
$previousVersion = '0.1.3'
$previousManifestSha256 = '3aae963d64b62837bc64996b8d78696c7dfc1e873200e4104bf4d8a490247599'
$previousInstallerSha256 = 'a6bc3428b5903962fa1c8dda81291d6b0aaf84886f7856a01acb2d34612176b7'
$previousInstallerSize = 617955235

function Get-FullPathWithin([string]$Path, [string]$Root) {
  $rootPath = [System.IO.Path]::GetFullPath($Root).TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
  $fullPath = [System.IO.Path]::GetFullPath($Path)
  if (-not $fullPath.StartsWith($rootPath, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Path escapes its allowed directory: $fullPath"
  }
  return $fullPath
}

function Get-AppRegistrations {
  $registrations = @()
  $registryRoots = @(
    'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
    'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
    'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall'
  )
  foreach ($root in $registryRoots) {
    if (-not (Test-Path -LiteralPath $root)) { continue }
    foreach ($entry in Get-ChildItem -LiteralPath $root) {
      $properties = Get-ItemProperty -LiteralPath $entry.PSPath
      $displayNameProperty = $properties.PSObject.Properties['DisplayName']
      $displayName = if ($displayNameProperty) { [string]$displayNameProperty.Value } else { '' }
      if ($displayName -ceq $productName -or $entry.PSChildName -ceq $appId) {
        $registrations += [pscustomobject]@{
          RegistryPath = $entry.Name
          KeyName = $entry.PSChildName
          DisplayName = $displayName
          DisplayVersion = [string]$properties.PSObject.Properties['DisplayVersion']?.Value
          InstallLocation = [string]$properties.PSObject.Properties['InstallLocation']?.Value
        }
      }
    }
  }
  return $registrations
}

function Invoke-SilentInstaller([string]$Path, [string]$AllowedRoot, [string[]]$Arguments = @('/S')) {
  $installerPath = Get-FullPathWithin $Path $AllowedRoot
  if (-not (Test-Path -LiteralPath $installerPath -PathType Leaf)) { throw "Installer is missing: $installerPath" }
  $process = Start-Process -FilePath $installerPath -ArgumentList $Arguments -WindowStyle Hidden -PassThru
  if (-not $process.WaitForExit(900000)) {
    Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    throw "Silent installer timed out: $Path"
  }
  if ($process.ExitCode -ne 0) { throw "Silent installer exited with code $($process.ExitCode): $Path" }
}

function Invoke-SilentUninstaller([string]$Path, [string]$InstallRoot) {
  $uninstaller = Get-FullPathWithin $Path $InstallRoot
  $copy = Get-FullPathWithin (Join-Path $auditRoot 'owned-uninstaller.exe') $auditRoot
  # NSIS's normal launcher forks and exits. Run an owned copy directly so we
  # observe the actual exit code and let it delete the installed uninstaller.
  # https://nsis.sourceforge.io/Docs/AppendixD.html#D.1
  Copy-Item -LiteralPath $uninstaller -Destination $copy -Force
  Invoke-SilentInstaller $copy $auditRoot @('/S', "_?=$InstallRoot")
}

function Get-Registration {
  $items = @(Get-AppRegistrations)
  if ($items.Count -ne 1) { throw "Expected exactly one PokeRogue Offline uninstall registration; found $($items.Count)." }
  if ($items[0].DisplayName -cne $productName) { throw "Unexpected uninstall display name: $($items[0].DisplayName)" }
  if (-not $items[0].RegistryPath.StartsWith('HKEY_CURRENT_USER\', [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "The app is not registered per-user: $($items[0].RegistryPath)"
  }
  if ($items[0].KeyName -cne $appGuid) { throw "Unexpected uninstall registry identity: $($items[0].KeyName)" }
  # NSIS records InstallLocation under Software\APP_GUID, separately from its uninstall entry.
  $installProperties = Get-ItemProperty -LiteralPath "HKCU:\Software\$appGuid"
  $items[0].InstallLocation = [string]$installProperties.PSObject.Properties['InstallLocation']?.Value
  if (-not $items[0].InstallLocation) { throw 'The NSIS installation registration has no install location.' }
  $installRoot = [System.IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'Programs'))
  $items[0].InstallLocation = Get-FullPathWithin $items[0].InstallLocation $installRoot
  return $items[0]
}

function Assert-FileHash([string]$Path, [string]$ExpectedHash, [long]$ExpectedSize) {
  $item = Get-Item -LiteralPath $Path
  $actualHash = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($item.Length -ne $ExpectedSize -or $actualHash -ne $ExpectedHash) {
    throw "File verification failed for $Path (size $($item.Length), SHA-256 $actualHash)."
  }
  return [pscustomobject]@{ size = $item.Length; sha256 = $actualHash }
}

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$releaseRoot = Get-FullPathWithin (Join-Path $repoRoot 'release') $repoRoot
$newInstaller = Get-FullPathWithin (Join-Path $repoRoot $NewInstallerPath) $releaseRoot
$releaseManifestPath = Get-FullPathWithin (Join-Path $repoRoot $ReleaseManifestPath) $releaseRoot
if (-not (Test-Path -LiteralPath $newInstaller -PathType Leaf)) { throw "New installer is missing: $newInstaller" }
if (-not (Test-Path -LiteralPath $releaseManifestPath -PathType Leaf)) { throw "Release manifest is missing: $releaseManifestPath" }

$appDataPath = Get-FullPathWithin (Join-Path $env:APPDATA $productName) $env:APPDATA
$installProgramsRoot = Get-FullPathWithin (Join-Path $env:LOCALAPPDATA 'Programs') $env:LOCALAPPDATA
$defaultInstallPath = Get-FullPathWithin (Join-Path $installProgramsRoot 'PokeRogue Offline') $installProgramsRoot
if (@(Get-AppRegistrations).Count -ne 0) { throw 'A PokeRogue Offline registration already exists; refusing to touch existing installation state.' }
foreach ($path in @($appDataPath, $defaultInstallPath)) {
  if (Test-Path -LiteralPath $path) { throw "PokeRogue Offline data or installation already exists at $path; refusing to touch it." }
}

$runId = if ($env:GITHUB_RUN_ID) { $env:GITHUB_RUN_ID } else { [guid]::NewGuid().ToString('N') }
$attempt = if ($env:GITHUB_RUN_ATTEMPT) { $env:GITHUB_RUN_ATTEMPT } else { '1' }
$auditRoot = Get-FullPathWithin (Join-Path $env:RUNNER_TEMP "pokerogue-windows-validation-$runId-$attempt") $env:RUNNER_TEMP
$oldManifestPath = Join-Path $auditRoot 'previous-release-manifest.json'
$oldInstallerPath = Join-Path $auditRoot 'PokeRogue-Offline-0.1.3-windows-x64.exe'
$evidencePath = Join-Path $auditRoot 'windows-install-validation.json'
$evidence = [ordered]@{
  status = 'running'
  preparedOnly = $false
  runner = [ordered]@{ environment = $env:RUNNER_ENVIRONMENT; os = [System.Runtime.InteropServices.RuntimeInformation]::OSDescription; architecture = [string][System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture }
  commit = $env:GITHUB_SHA
  appId = $appId
  productName = $productName
  packageVersion = (Get-Content -LiteralPath (Join-Path $repoRoot 'package.json') -Raw | ConvertFrom-Json).version
  nodeVersion = (& node --version)
  electronVersion = (& node -p "require('./node_modules/electron/package.json').version")
  sourcePins = (Get-Content -LiteralPath (Join-Path $repoRoot 'build/local-macos-build.json') -Raw | ConvertFrom-Json)
  stagedRevisions = (Get-Content -LiteralPath (Join-Path $repoRoot 'staging/revisions.json') -Raw | ConvertFrom-Json)
  previousRelease = [ordered]@{ version = $previousVersion; manifestSha256 = $previousManifestSha256; installerSha256 = $previousInstallerSha256; installerSize = $previousInstallerSize }
  filePreservation = [ordered]@{ beforeUpgrade = [ordered]@{}; afterUpgrade = [ordered]@{}; afterUninstall = [ordered]@{} }
  newInstaller = $null
  releaseManifestSha256 = $null
  checks = [System.Collections.Generic.List[string]]::new()
  registrationIdentity = $null
  dataPolicy = 'Only inert sentinel files and neutral configuration were checked; this does not prove live database consistency or save behavior.'
  handsOnGaps = @('Offline gameplay', 'Update UI and download/install flow', 'Genuine game database consistency and Save data restoration')
  failure = $null
  cleanup = 'not-needed'
}
$initialRegistration = $null
$uninstallCompleted = $false

try {
  New-Item -ItemType Directory -Path $auditRoot -Force | Out-Null
  $manifestUrl = 'https://github.com/gaboopa/pokerogue-electron/releases/download/v0.1.3/release-manifest.json'
  Invoke-WebRequest -Uri $manifestUrl -OutFile $oldManifestPath -TimeoutSec 300
  $oldManifestHash = (Get-FileHash -LiteralPath $oldManifestPath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($oldManifestHash -ne $previousManifestSha256) { throw "Previous release manifest checksum mismatch: $oldManifestHash" }
  $oldManifest = Get-Content -LiteralPath $oldManifestPath -Raw | ConvertFrom-Json
  if ($oldManifest.version -cne $previousVersion) { throw 'Previous release manifest version mismatch.' }
  $oldAssets = @($oldManifest.artifacts | Where-Object { $_.platform -ceq 'windows' -and $_.arch -ceq 'x64' })
  if ($oldAssets.Count -ne 1) { throw 'Previous release manifest must contain exactly one Windows x64 installer.' }
  $oldAsset = $oldAssets[0]
  if ($oldAsset.fileName -cne 'PokeRogue-Offline-0.1.3-windows-x64.exe' -or $oldAsset.sha256 -cne $previousInstallerSha256 -or [long]$oldAsset.size -ne $previousInstallerSize -or $oldAsset.downloadUrl -cne 'https://github.com/gaboopa/pokerogue-electron/releases/download/v0.1.3/PokeRogue-Offline-0.1.3-windows-x64.exe') {
    throw 'Previous release installer does not match the verified official metadata.'
  }
  $evidence.checks.Add('Downloaded previous official manifest and matched its published checksum and pinned installer metadata.')

  Invoke-WebRequest -Uri $oldAsset.downloadUrl -OutFile $oldInstallerPath -TimeoutSec 2400
  $oldInstallerEvidence = Assert-FileHash $oldInstallerPath $previousInstallerSha256 $previousInstallerSize
  $evidence.previousRelease.installedInstaller = [ordered]@{ fileName = [System.IO.Path]::GetFileName($oldInstallerPath); size = $oldInstallerEvidence.size; sha256 = $oldInstallerEvidence.sha256 }
  $evidence.checks.Add('Verified previous installer size and SHA-256 before execution.')

  Invoke-SilentInstaller $oldInstallerPath $auditRoot
  $initialRegistration = Get-Registration
  if ($initialRegistration.DisplayVersion -cne $previousVersion) { throw "Expected installed version $previousVersion, found $($initialRegistration.DisplayVersion)." }
  $uninstallerPath = Get-FullPathWithin (Join-Path $initialRegistration.InstallLocation 'Uninstall PokeRogue Offline.exe') $initialRegistration.InstallLocation
  if (-not (Test-Path -LiteralPath $uninstallerPath -PathType Leaf)) { throw "Expected per-user uninstaller is missing: $uninstallerPath" }
  $evidence.registrationIdentity = [ordered]@{ registryPath = $initialRegistration.RegistryPath; keyName = $initialRegistration.KeyName; installLocation = $initialRegistration.InstallLocation; previousDisplayVersion = $initialRegistration.DisplayVersion }
  $evidence.checks.Add('Installed v0.1.3 silently and confirmed one per-user registration with the expected identity.')

  New-Item -ItemType Directory -Path $appDataPath | Out-Null
  $sentinelValue = "Windows validation sentinel $([guid]::NewGuid().ToString('N'))`n"
  $sentinelPath = Join-Path $appDataPath 'validation-sentinel.txt'
  $keymapPath = Join-Path $appDataPath 'keymap.json'
  $cheatsPath = Join-Path $appDataPath 'cheats.json'
  $sentinelValue | Set-Content -LiteralPath $sentinelPath -NoNewline -Encoding utf8
  '{"W":"ArrowUp","A":"ArrowLeft"}' | Set-Content -LiteralPath $keymapPath -NoNewline -Encoding utf8
  '{"schemaVersion":1,"config":{"enabled":false},"usage":{"everEnabled":false,"lastEnabledAt":null,"lastAppliedAt":null,"applyCount":0}}' | Set-Content -LiteralPath $cheatsPath -NoNewline -Encoding utf8
  $preservedFiles = @($sentinelPath, $keymapPath, $cheatsPath)
  $beforeHashes = @{}
  foreach ($path in $preservedFiles) {
    $hash = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
    $beforeHashes[$path] = $hash
    $evidence.filePreservation.beforeUpgrade[[System.IO.Path]::GetFileName($path)] = $hash
  }
  $evidence.checks.Add('Created an inert sentinel, a valid local keymap, and a neutral cheat document in the fresh profile.')

  $newManifest = Get-Content -LiteralPath $releaseManifestPath -Raw | ConvertFrom-Json
  $newPackageVersion = [string]$evidence.packageVersion
  if ([version]$newPackageVersion -le [version]$previousVersion) { throw 'The candidate installer must have a version newer than the pinned previous release.' }
  if ($newManifest.version -cne $newPackageVersion) { throw 'New release manifest version does not match package.json.' }
  $newAssets = @($newManifest.artifacts | Where-Object { $_.platform -ceq 'windows' -and $_.arch -ceq 'x64' })
  if ($newAssets.Count -ne 1) { throw 'New release manifest must contain exactly one Windows x64 installer.' }
  $newAsset = $newAssets[0]
  $newInstallerEvidence = Assert-FileHash $newInstaller $newAsset.sha256 ([long]$newAsset.size)
  if ($newAsset.fileName -cne (Split-Path -Leaf $newInstaller)) { throw 'New release manifest filename does not match the built installer.' }
  $evidence.newInstaller = [ordered]@{ fileName = $newAsset.fileName; size = $newInstallerEvidence.size; sha256 = $newInstallerEvidence.sha256 }
  $evidence.releaseManifestSha256 = (Get-FileHash -LiteralPath $releaseManifestPath -Algorithm SHA256).Hash.ToLowerInvariant()
  $evidence.checks.Add('Verified the new installer bytes against the generated Windows x64 release manifest before execution.')

  Invoke-SilentInstaller $newInstaller $releaseRoot
  $upgradedRegistration = Get-Registration
  if ($upgradedRegistration.DisplayVersion -cne $newPackageVersion) { throw "Expected upgraded version $newPackageVersion, found $($upgradedRegistration.DisplayVersion)." }
  if ($upgradedRegistration.RegistryPath -cne $initialRegistration.RegistryPath -or $upgradedRegistration.KeyName -cne $initialRegistration.KeyName -or $upgradedRegistration.InstallLocation -cne $initialRegistration.InstallLocation) {
    throw 'Upgrade changed the per-user registration identity or install location.'
  }
  foreach ($path in $preservedFiles) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Upgrade removed user-data file: $path" }
    $actualHash = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
    $evidence.filePreservation.afterUpgrade[[System.IO.Path]::GetFileName($path)] = $actualHash
    if ($actualHash -cne $beforeHashes[$path]) { throw "Upgrade changed user-data file: $path" }
  }
  $evidence.registrationIdentity.upgradedDisplayVersion = $upgradedRegistration.DisplayVersion
  $evidence.checks.Add('Upgraded silently, retained one unchanged per-user registration identity, and preserved every sentinel/configuration file byte-for-byte.')

  Invoke-SilentUninstaller $uninstallerPath $initialRegistration.InstallLocation
  $uninstallCompleted = $true
  if (@(Get-AppRegistrations).Count -ne 0) { throw 'The app registration remains after silent uninstall.' }
  if (Test-Path -LiteralPath $uninstallerPath) { throw 'The app uninstaller remains after silent uninstall.' }
  foreach ($path in $preservedFiles) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Uninstall removed user data despite the retain policy: $path" }
    $actualHash = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
    $evidence.filePreservation.afterUninstall[[System.IO.Path]::GetFileName($path)] = $actualHash
    if ($actualHash -cne $beforeHashes[$path]) { throw "Uninstall changed user-data file: $path" }
  }
  $evidence.checks.Add('Uninstalled silently, removed the application registration, and retained inert user-data sentinels as configured.')
  $evidence.status = 'passed'
} catch {
  $evidence.status = 'failed'
  $evidence.failure = $_.Exception.Message
  throw
} finally {
  if (-not $uninstallCompleted) {
    try {
      if ($null -eq $initialRegistration) {
        $evidence.cleanup = 'no owned installation identity was recorded; ephemeral runner will be discarded'
      } else {
        $remaining = @(Get-AppRegistrations)
        if ($remaining.Count -eq 0) {
          $evidence.cleanup = 'no installation registration remained'
        } else {
          $remainingRegistration = Get-Registration
          if ($remainingRegistration.RegistryPath -cne $initialRegistration.RegistryPath -or $remainingRegistration.KeyName -cne $initialRegistration.KeyName -or $remainingRegistration.InstallLocation -cne $initialRegistration.InstallLocation) {
            throw 'Remaining registration does not match the recorded installation identity and location; refusing cleanup launch.'
          }
          $remainingInstaller = Get-FullPathWithin (Join-Path $remainingRegistration.InstallLocation 'Uninstall PokeRogue Offline.exe') $remainingRegistration.InstallLocation
          if (Test-Path -LiteralPath $remainingInstaller -PathType Leaf) {
            Invoke-SilentUninstaller $remainingInstaller $remainingRegistration.InstallLocation
            $evidence.cleanup = 'removed the recorded partial installation with its contained per-user uninstaller; user data was retained'
          } else {
            $evidence.cleanup = 'recorded installation remains without its expected uninstaller; ephemeral runner will be discarded'
          }
        }
      }
    } catch {
      $evidence.cleanup = "cleanup attempt failed: $($_.Exception.Message); ephemeral runner will be discarded"
    }
  }
  if (Test-Path -LiteralPath $auditRoot -PathType Container) {
    $evidence | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $evidencePath -Encoding utf8
    Write-Output "Windows installer validation evidence: $evidencePath"
  }
}
