@echo off
setlocal
node "%~dp0..\..\..\tools\huashu-motion\cli\om.js" %*
exit /b %errorlevel%
