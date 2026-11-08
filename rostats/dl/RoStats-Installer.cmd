@echo off
title Installation de RoStats
powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://rostats.vercel.app/dl/install.ps1 | iex"
echo.
pause
