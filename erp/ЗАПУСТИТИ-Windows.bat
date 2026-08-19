@echo off
chcp 65001 >nul
title VERDE ERP
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Спершу встановіть Node.js — це разово, 5 хвилин:
  echo   https://nodejs.org  (кнопка LTS, далі «Далі» скрізь^)
  echo.
  echo   Після встановлення закрийте це вікно й запустіть файл знову.
  echo.
  pause
  exit /b 1
)

node scripts\start.mjs
pause
