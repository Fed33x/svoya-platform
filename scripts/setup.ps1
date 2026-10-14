$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')
if (Test-Path '.env') {
    Write-Host '.env already exists. Existing settings were kept.'
    exit
}
$adminSecret = [guid]::NewGuid().ToString('N')
$tvSecret = [guid]::NewGuid().ToString('N')
@"
ADMIN_PASSWORD=$adminSecret
TV_KEY=$tvSecret
PORT=3000
PUBLIC_URL=
COOKIE_SECURE=false
"@ | Set-Content -Encoding ascii '.env'
Write-Host "Admin password: $adminSecret"
Write-Host "TV key: $tvSecret"
Write-Host 'Set PUBLIC_URL in .env to the server address available to phones and TV.'
