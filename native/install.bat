@echo off
rem Double-click to install the helper for this Windows user (no admin needed).
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"
pause
