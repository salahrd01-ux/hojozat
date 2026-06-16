@echo off
title Hojozat Server
color 0B
echo.
echo ============================================
echo    HOJOZAT - Starting Server
echo ============================================
echo.
echo    Backend:     http://localhost:5000
echo    Admin Panel: html/admin/login.html
echo    Admin Login: admin@hojozat.com / admin123456
echo.
echo    Press Ctrl+C to stop the server.
echo ============================================
echo.
cd /d "%~dp0backend"
call npm run dev
pause
