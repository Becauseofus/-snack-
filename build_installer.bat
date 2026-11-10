@echo off
cd /d "%~dp0"
python build_installer.py
if errorlevel 1 pause
