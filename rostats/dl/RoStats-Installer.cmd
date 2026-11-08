@echo off
title Installation de RoStats
powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://rostats-seven.vercel.app/dl/install.ps1 | iex"
echo.
pause
