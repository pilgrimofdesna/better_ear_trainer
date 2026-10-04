@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "PATH=C:\Program Files\nodejs;%PATH%"
echo Stellar Ear 빌드 중...
call npm run build || pause
echo.
echo 폰(같은 와이파이)에서 아래 Network 주소로 접속하세요. 끝내려면 이 창을 닫으면 됩니다.
echo 기록은 접속 주소(IP와 포트 5173)마다 따로 저장돼요. 폰에서는 늘 같은 주소로 들어가세요.
echo 처음 한 번 Windows 방화벽 창이 뜨면 "개인 네트워크" 허용을 눌러 주세요.
echo.
call npm run serve
echo.
echo 서버가 멈췄어요. "Port 5173 is already in use"가 보이면 이미 켜 둔 서버 창이나 npm run dev를 닫고 다시 실행하세요.
pause
