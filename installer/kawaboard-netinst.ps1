#Requires -Version 5.1
<#
    kawaboard netinst — GUI-сетевой установщик для Windows.
    Качает последний релиз с GitHub и ставит в %LOCALAPPDATA% (без админки).
    Быстрый запуск:
    powershell -NoProfile -ExecutionPolicy Bypass -Command "iwr https://raw.githubusercontent.com/vi-is-ramen/kawaboard/main/installer/kawaboard-netinst.ps1 -UseBasicParsing | iex"
#>
param(
    [string]$Repo  = 'vi-is-ramen/kawaboard',
    [string]$Tag   = '',                      # пусто = latest
    [string]$Asset = 'kawaboard-.*windows-x64\.exe'
)
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
[System.Windows.Forms.Control]::CheckForIllegalCrossThreadCalls = $false | Out-Null

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Control]::CheckForIllegalCrossThreadCalls = $false

# ---------- релиз ----------
$apiUrl = if ($Tag) { "https://api.github.com/repos/$Repo/releases/tags/$Tag" }
          else     { "https://api.github.com/repos/$Repo/releases/latest" }
$release = Invoke-RestMethod -Uri $apiUrl -Headers @{ 'User-Agent' = 'kawaboard-netinst' }
$assetInfo = $release.assets | Where-Object { $_.name -match "^$Asset$" } | Select-Object -First 1
if (-not $assetInfo) { throw "Ассет не найден в релизе $($release.tag_name) T_T" }

# ---------- GUI ----------
$form = New-Object System.Windows.Forms.Form
$form.Text = 'kawaboard netinst'
$form.Size = New-Object System.Drawing.Size(480, 330)
$form.StartPosition = 'CenterScreen'
$form.FormBorderStyle = 'FixedDialog'
$form.MaximizeBox = $false
$form.Font = New-Object System.Drawing.Font('Segoe UI', 9)

$title = New-Object System.Windows.Forms.Label
$title.Text = 'kawaboard netinst ^_^'
$title.Font = New-Object System.Drawing.Font('Segoe UI', 14, [System.Drawing.FontStyle]::Bold)
$title.Location = '16,14'; $title.Size = '430,30'

$ver = New-Object System.Windows.Forms.Label
$ver.Text = "релиз: $($release.tag_name)  |  $($assetInfo.name)"
$ver.Location = '16,48'; $ver.Size = '430,20'
$ver.ForeColor = [System.Drawing.Color]::Gray

$lblPath = New-Object System.Windows.Forms.Label
$lblPath.Text = 'Папка установки:'
$lblPath.Location = '16,78'; $lblPath.Size = '430,18'

$defaultDir = Join-Path $env:LOCALAPPDATA 'kawaboard'
$txtPath = New-Object System.Windows.Forms.TextBox
$txtPath.Text = $defaultDir
$txtPath.Location = '16,100'; $txtPath.Size = '330,24'

$btnBrowse = New-Object System.Windows.Forms.Button
$btnBrowse.Text = '...'
$btnBrowse.Location = '352,99'; $btnBrowse.Size = '94,26'
$btnBrowse.Add_Click({
    $dlg = New-Object System.Windows.Forms.FolderBrowserDialog
    $dlg.SelectedPath = $txtPath.Text
    if ($dlg.ShowDialog() -eq 'OK') { $txtPath.Text = $dlg.SelectedPath }
})

$chkStart = New-Object System.Windows.Forms.CheckBox
$chkStart.Text = 'Ярлык в меню Пуск'; $chkStart.Checked = $true
$chkStart.Location = '16,132'; $chkStart.Size = '200,22'

$chkDesk = New-Object System.Windows.Forms.CheckBox
$chkDesk.Text = 'Ярлык на рабочем столе'
$chkDesk.Location = '220,132'; $chkDesk.Size = '200,22'

$chkRun = New-Object System.Windows.Forms.CheckBox
$chkRun.Text = 'Запустить после установки'; $chkRun.Checked = $true
$chkRun.Location = '16,156'; $chkRun.Size = '250,22'

$progress = New-Object System.Windows.Forms.ProgressBar
$progress.Location = '16,188'; $progress.Size = '430,22'

$status = New-Object System.Windows.Forms.Label
$status.Text = 'готово качать~'
$status.Location = '16,214'; $status.Size = '430,20'

$btnInstall = New-Object System.Windows.Forms.Button
$btnInstall.Text = 'Установить'
$btnInstall.Location = '16,244'; $btnInstall.Size = '120,30'

$btnClose = New-Object System.Windows.Forms.Button
$btnClose.Text = 'Закрыть'
$btnClose.Location = '346,244'; $btnClose.Size = '100,30'
$btnClose.Add_Click({ $form.Close() })

function New-Shortcut($target, $linkPath) {
    $ws = New-Object -ComObject WScript.Shell
    $sc = $ws.CreateShortcut($linkPath)
    $sc.TargetPath = $target
    $sc.WorkingDirectory = (Split-Path $target)
    $sc.Save()
}

$btnInstall.Add_Click({
    $btnInstall.Enabled = $false
    $dir = $txtPath.Text
    try {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
        $tmp = Join-Path $env:TEMP $assetInfo.name
        $status.Text = 'качаем с GitHub...'

        $wc = New-Object System.Net.WebClient
        $wc.Headers.Add('User-Agent', 'kawaboard-netinst')
        $script:done = $false
        $wc.add_ProgressChanged({ param($s, $e)
            $progress.Value = $e.ProgressPercentage
            $status.Text = "качаем... $($e.ProgressPercentage)%"
        })
        $wc.add_DownloadFileCompleted({ param($s, $e)
            $script:done = $true
            if ($e.Error) { $status.Text = "ошибка загрузки T_T: $($e.Error.Message)" }
        })
        $wc.DownloadFileAsync($assetInfo.browser_download_url, $tmp)
        while (-not $script:done) {
            [System.Windows.Forms.Application]::DoEvents()
            Start-Sleep -Milliseconds 50
        }
        if (-not (Test-Path $tmp)) { throw 'загрузка не удалась' }

        $exe = Join-Path $dir 'kawaboard.exe'
        Move-Item -Path $tmp -Destination $exe -Force
        $progress.Value = 100

        # ярлыки
        if ($chkStart.Checked) {
            $sm = Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'Microsoft\Windows\Start Menu\Programs'
            New-Item -ItemType Directory -Path $sm -Force | Out-Null
            New-Shortcut $exe (Join-Path $sm 'kawaboard.lnk')
        }
        if ($chkDesk.Checked) {
            New-Shortcut $exe (Join-Path ([Environment]::GetFolderPath('Desktop')) 'kawaboard.lnk')
        }

        # uninstall-скрипт + запись в "Установку и удаление программ"
        $un = Join-Path $dir 'uninstall.ps1'
        @"
`$ErrorActionPreference = 'SilentlyContinue'
Remove-Item "$([Environment]::GetFolderPath('ApplicationData'))\Microsoft\Windows\Start Menu\Programs\kawaboard.lnk"
Remove-Item "$([Environment]::GetFolderPath('Desktop'))\kawaboard.lnk"
Remove-Item 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\kawaboard' -Recurse
Remove-Item '$dir' -Recurse -Force
"@ | Set-Content -Path $un -Encoding UTF8

        $reg = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\kawaboard'
        New-Item -Path $reg -Force | Out-Null
        Set-ItemProperty $reg DisplayName 'kawaboard'
        Set-ItemProperty $reg DisplayVersion $release.tag_name
        Set-ItemProperty $reg Publisher 'vi-is-ramen'
        Set-ItemProperty $reg InstallLocation $dir
        Set-ItemProperty $reg UninstallString "powershell.exe -ExecutionPolicy Bypass -NoProfile -File `"$un`""

        $status.Text = 'установлено ^_^'
        if ($chkRun.Checked) { Start-Process $exe }
    } catch {
        $status.Text = "ошибка T_T: $_"
        $btnInstall.Enabled = $true
    }
})

$form.Controls.AddRange(@($title, $ver, $lblPath, $txtPath, $btnBrowse, $chkStart, $chkDesk, $chkRun, $progress, $status, $btnInstall, $btnClose))
[void]$form.ShowDialog()
