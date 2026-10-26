@echo off
setlocal
if defined HUASHU_MOTION_CLI (
  node "%HUASHU_MOTION_CLI%" %*
  exit /b
)
if exist "%~dp0..\..\..\cli\om.js" (
  node "%~dp0..\..\..\cli\om.js" %*
  exit /b
)
node "%~dp0..\..\..\tools\huashu-motion\cli\om.js" %*
exit /b %errorlevel%
