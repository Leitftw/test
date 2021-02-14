# --- LRR Windows build script ---

Add-Type -AssemblyName System.IO.Compression.FileSystem
function Unzip
{
    param([string]$zipfile, [string]$outpath)

    [System.IO.Compression.ZipFile]::ExtractToDirectory($zipfile, $outpath)
}

echo "🎌 Building up LRR Windows Package 🎌"
echo "Inferring version from package.json..."

$json = (Get-Content "package.json" -Raw) | ConvertFrom-Json
$version = $json.version
echo "Version is $version"
$env:LRR_VERSION_NUM=$version

# Use Docker image
mv .\package\package.tar .\tools\build\windows\Karen\External\package.tar 

# Use Karen master
cd .\tools\build\windows\Karen
echo (Resolve-Path .\).Path
nuget restore

# Download LxRunOffline
Invoke-WebRequest https://github.com/DDoSolitary/LxRunOffline/releases/download/v3.4.1/LxRunOffline-v3.4.1-msvc.zip -outfile .\lxro.zip -verbose
echo (dir)
Unzip .\tools\build\windows\Karen\lxro.zip .\tools\build\windows\Karen\External\LxRunOffline

# Build Karen and Setup 
msbuild /p:Configuration=Release /p:Platform=x64

Get-FileHash .\Setup\bin\LANraragi.msi | Format-List
