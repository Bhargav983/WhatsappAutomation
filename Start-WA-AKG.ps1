param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$appRoot = $PSScriptRoot
$appUrl = 'http://localhost:3000'
$mutex = New-Object System.Threading.Mutex($false, 'Local\WA-AKG-Launcher')
$locked = $false
function Test-App {
    try {
        $response = Invoke-RestMethod "$appUrl/api/auth/providers" -TimeoutSec 3
        return $response.credentials.id -eq 'credentials'
    } catch { return $false }
}
function Test-DatabasePort {
    $client = New-Object Net.Sockets.TcpClient
    try {
        $task = $client.ConnectAsync('127.0.0.1', 3306)
        return ($task.Wait(1500) -and $client.Connected)
    } catch { return $false } finally { $client.Dispose() }
}
try {
    $locked = $mutex.WaitOne(120000)
    if (-not $locked) { throw 'Another WA-AKG launch is still in progress. Try again shortly.' }
    if (-not (Test-DatabasePort)) {
        $mysqlExe = 'C:\db\mysql\bin\mysqld.exe'
        $mysqlConfig = 'C:\db\mysql\bin\my.ini'
        if (-not (Test-Path $mysqlExe)) { throw 'Start MySQL in the XAMPP Control Panel, then open WA-AKG again.' }
        Start-Process -FilePath $mysqlExe -ArgumentList '--defaults-file=C:\db\mysql\bin\my.ini', '--standalone' -WorkingDirectory 'C:\db' -WindowStyle Hidden
        $dbDeadline = (Get-Date).AddSeconds(30)
        while (-not (Test-DatabasePort)) {
            if ((Get-Date) -gt $dbDeadline) { throw 'MySQL did not start. Open the XAMPP Control Panel and check its MySQL log.' }
            Start-Sleep -Seconds 1
        }
    }
    if (-not (Test-App)) {
        if (-not (Test-Path "$appRoot\.next\BUILD_ID")) { throw 'Production build missing. Run npm.cmd run build in the WA-AKG folder.' }
        New-Item -ItemType Directory -Force "$appRoot\logs" | Out-Null
        $nodeExe = (Get-Command node.exe -ErrorAction Stop).Source
        $env:NODE_ENV = 'production'
        $env:NEXT_TELEMETRY_DISABLED = '1'
        $server = Start-Process -FilePath $nodeExe -ArgumentList 'node_modules/tsx/dist/cli.mjs', 'src/server/index.ts' -WorkingDirectory $appRoot -WindowStyle Hidden -RedirectStandardOutput "$appRoot\logs\server.out.log" -RedirectStandardError "$appRoot\logs\server.err.log" -PassThru
        $server.Id | Set-Content "$appRoot\logs\server.pid"
        $deadline = (Get-Date).AddSeconds(90)
        while (-not (Test-App)) {
            $server.Refresh()
            if ($server.HasExited) { throw "WA-AKG exited. See $appRoot\logs\server.err.log" }
            if ((Get-Date) -gt $deadline) { throw "WA-AKG took too long to start. See $appRoot\logs\server.err.log" }
            Start-Sleep -Seconds 1
        }
    }
    if (-not $NoBrowser) {
        $chromePath = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
        if (Test-Path $chromePath) { Start-Process $chromePath "$appUrl/dashboard" }
        else { Start-Process "$appUrl/dashboard" }
    }
    Write-Output "WA-AKG is ready at $appUrl/dashboard"
} catch {
    if ($NoBrowser) { throw }
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, 'WA-AKG startup', 'OK', 'Error') | Out-Null
    exit 1
} finally {
    if ($locked) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
}
