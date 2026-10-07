@echo off
rem Starts hdfx_file.ps1, the fallback where hdfx_file.exe could not be built.
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%~dp0hdfx_file.ps1"
