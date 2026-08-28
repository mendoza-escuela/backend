<#
.SYNOPSIS
    Ejecuta la suite de seguridad en Windows.

.DESCRIPTION
    Envoltorio de los mismos scripts que usa CI. No duplica lógica: comprueba
    los requisitos y delega en bash, de modo que el resultado en Windows y en
    Linux sea idéntico.

    Requisitos: Docker Desktop y Git para Windows (aporta bash).

.PARAMETER StaticOnly
    Sólo análisis estático. No levanta el entorno con Docker Compose.

.PARAMETER FullDast
    ZAP full scan (activo) en lugar del baseline.

.PARAMETER KeepEnv
    No destruye el entorno efímero al terminar.

.EXAMPLE
    .\security\run-security.ps1
    .\security\run-security.ps1 -StaticOnly
    .\security\run-security.ps1 -FullDast -KeepEnv
#>
[CmdletBinding()]
param(
    [switch]$StaticOnly,
    [switch]$FullDast,
    [switch]$KeepEnv
)

$ErrorActionPreference = 'Stop'

function Write-Step {
    param([string]$Message)
    Write-Host ""
    Write-Host "==== $Message ====" -ForegroundColor Cyan
}

function Write-Problem {
    param([string]$Message)
    Write-Host $Message -ForegroundColor Red
}

# --- Requisitos --------------------------------------------------------------
Write-Step "Comprobando requisitos"

$docker = Get-Command docker -ErrorAction SilentlyContinue
if ($null -eq $docker) {
    Write-Problem "Docker no esta instalado o no esta en el PATH."
    Write-Host "Instalalo desde https://www.docker.com/products/docker-desktop/"
    exit 1
}

try {
    docker info 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "el demonio no responde" }
} catch {
    Write-Problem "Docker esta instalado pero el demonio no responde."
    Write-Host "Abri Docker Desktop y espera a que arranque."
    exit 1
}
Write-Host "Docker: OK" -ForegroundColor Green

# Git para Windows trae bash; se busca primero en el PATH y despues en la
# ubicacion habitual de la instalacion.
$bash = (Get-Command bash -ErrorAction SilentlyContinue).Source
if (-not $bash) {
    $candidatos = @(
        "$env:ProgramFiles\Git\bin\bash.exe",
        "${env:ProgramFiles(x86)}\Git\bin\bash.exe",
        "$env:LOCALAPPDATA\Programs\Git\bin\bash.exe"
    )
    foreach ($candidato in $candidatos) {
        if (Test-Path $candidato) { $bash = $candidato; break }
    }
}
if (-not $bash) {
    Write-Problem "No se encontro bash."
    Write-Host "Instala Git para Windows: https://git-scm.com/download/win"
    Write-Host "Alternativa: ejecutar la suite desde WSL."
    exit 1
}
Write-Host "bash: $bash" -ForegroundColor Green

# --- Ubicacion ---------------------------------------------------------------
$repoRoot = Split-Path -Parent $PSScriptRoot
Push-Location $repoRoot
Write-Host "Repositorio: $repoRoot" -ForegroundColor Green

try {
    # --- Argumentos ----------------------------------------------------------
    $argumentos = @()
    if ($StaticOnly) { $argumentos += '--static-only' }
    if ($FullDast)   { $argumentos += '--full-dast' }
    if ($KeepEnv)    { $argumentos += '--keep-env' }

    Write-Step "Ejecutando la suite de seguridad"
    if ($argumentos.Count -gt 0) {
        Write-Host "Opciones: $($argumentos -join ' ')"
    }
    Write-Host "La primera ejecucion descarga unos 6 GB de imagenes."
    Write-Host ""

    & $bash './security/scripts/run-all.sh' @argumentos
    $codigoSalida = $LASTEXITCODE

    # --- Resultado -----------------------------------------------------------
    Write-Step "Resultado"
    $resumen = Join-Path $repoRoot 'security\reports\summary.md'
    if (Test-Path $resumen) {
        Get-Content $resumen -TotalCount 30 | ForEach-Object { Write-Host $_ }
        Write-Host ""
        Write-Host "Resumen completo: security\reports\summary.md"
    } else {
        Write-Problem "No se genero el resumen. Revisa la salida de arriba."
    }

    if ($codigoSalida -ne 0) {
        Write-Problem "`nLa politica de seguridad BLOQUEA este cambio (codigo $codigoSalida)."
        Write-Host "Corregi los hallazgos o documenta una excepcion en"
        Write-Host "security\exceptions\security-exceptions.yml"
    } else {
        Write-Host "`nLa politica de seguridad no bloquea este cambio." -ForegroundColor Green
        Write-Host "Revisa igualmente las advertencias del resumen."
    }

    exit $codigoSalida
}
finally {
    Pop-Location
}
