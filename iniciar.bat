@echo off
rem Silhueta: abre o site num servidor local (dois cliques neste arquivo).
chcp 65001 >nul
title Silhueta - servidor local
cd /d "%~dp0"
set PORT=5173

where node >nul 2>nul
if %errorlevel%==0 goto usar_node
where py >nul 2>nul
if %errorlevel%==0 goto usar_py
where python >nul 2>nul
if %errorlevel%==0 goto usar_python

echo.
echo Nao encontrei o Node.js nem o Python neste computador.
echo Instale o Node.js em https://nodejs.org e de dois cliques neste arquivo de novo.
echo.
pause
exit /b 1

:usar_node
echo.
echo Silhueta em http://localhost:%PORT%
echo Mantenha esta janela aberta enquanto usar o site. Feche para parar.
echo.
start "" /min cmd /c "ping -n 3 127.0.0.1 >nul & start http://localhost:%PORT%"
node scripts\dev-server.mjs %PORT%
goto fim

:usar_py
echo.
echo Silhueta em http://localhost:%PORT%  (via Python)
echo Mantenha esta janela aberta enquanto usar o site. Feche para parar.
echo.
start "" /min cmd /c "ping -n 3 127.0.0.1 >nul & start http://localhost:%PORT%"
py -m http.server %PORT%
goto fim

:usar_python
echo.
echo Silhueta em http://localhost:%PORT%  (via Python)
echo Mantenha esta janela aberta enquanto usar o site. Feche para parar.
echo.
start "" /min cmd /c "ping -n 3 127.0.0.1 >nul & start http://localhost:%PORT%"
python -m http.server %PORT%

:fim
pause
