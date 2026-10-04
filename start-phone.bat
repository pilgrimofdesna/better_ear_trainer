@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "PATH=C:\Program Files\nodejs;%PATH%"
echo Stellar Ear 빌드 중...
call npm run build || pause
echo.
echo 폰(같은 와이파이)에서 아래 Network 주소로 접속하세요. 끝내려면 이 창을 닫으면 됩니다.
echo 처음 한 번 Windows 방화벽 창이 뜨면 "개인 네트워크" 허용을 눌러 주세요.
echo.
call npm run serve
pause
