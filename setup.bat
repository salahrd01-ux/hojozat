@echo off
title Hojozat Admin Setup
color 0A
echo.
echo ============================================
echo    HOJOZAT - Admin Panel Setup
echo ============================================
echo.

REM Navigate to backend directory
cd /d "%~dp0backend"

echo [1/3] Installing dependencies...
echo.
call npm install
if %ERRORLEVEL% neq 0 (
    echo.
    echo ERROR: npm install failed!
    echo Make sure Node.js is installed.
    pause
    exit /b 1
)
echo.
echo Dependencies installed!
echo.

echo [2/3] Seeding database with admin user...
echo.
call npm run seed
if %ERRORLEVEL% neq 0 (
    echo.
    echo ERROR: Database seed failed!
    echo Make sure MongoDB is running.
    pause
    exit /b 1
)
echo.
echo Database seeded!
echo.

echo [3/3] Starting backend server...
echo.
echo ============================================
echo    Server starting on http://localhost:5000
echo ============================================
echo.
echo    Admin Login: admin@hojozat.com / admin123456
echo    Admin URL:   html/admin/login.html
echo.
echo    Press Ctrl+C to stop the server.
echo ============================================
echo.
call npm run dev
pause
