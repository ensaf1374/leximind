@echo off
rem LexiMind desktop launcher.
rem Opens LexiMind in its own window, like an installed app. If the app's small local server is not
rem running yet, it is started quietly in the background first (no window to keep open).
rem LexiMind uses its own port (8321) so it never collides with other local apps.
setlocal
cd /d "%~dp0"
set "URL=http://localhost:8321/"

rem 1) Already running?
curl -s -m 2 %URL%manifest.webmanifest 2>nul | findstr /c:"LexiMind" >nul && goto open

rem 2) Not running: start it hidden, then wait until it answers
where pythonw >nul 2>nul
if errorlevel 1 goto nopython
start "" pythonw "%~dp0serve.pyw" 8321
set /a TRIES=0
:wait
curl -s -m 1 %URL%manifest.webmanifest 2>nul | findstr /c:"LexiMind" >nul && goto open
set /a TRIES+=1
if %TRIES% geq 15 goto failed
ping -n 2 127.0.0.1 >nul
goto wait

:open
set "EDGE=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not exist "%EDGE%" set "EDGE=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
if exist "%EDGE%" goto edge
set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if exist "%CHROME%" goto chrome
start "" "%URL%"
goto :eof

:edge
start "" "%EDGE%" --app=%URL%
goto :eof

:chrome
start "" "%CHROME%" --app=%URL%
goto :eof

:failed
echo LexiMind could not start. Another program may be using port 8321.
pause
goto :eof

:nopython
echo LexiMind needs Python to run on this computer.
echo Install it from https://www.python.org/downloads/ and open LexiMind again.
pause
