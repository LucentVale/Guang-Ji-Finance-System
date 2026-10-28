@echo off
title Sistem Keuangan Guang Ji
cd /d "%~dp0"
if not exist node_modules (
  echo Menginstal komponen, mohon tunggu...
  call npm install
)
start "" http://localhost:3000
node server.js
pause
