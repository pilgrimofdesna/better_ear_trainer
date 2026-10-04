# Stellar Ear — 기능 청음 트레이너

조성 맥락을 듣고 음의 자리(스케일 디그리)를 맞히는 웹앱. 개발 계획은 [docs/02-dev-plan.md](docs/02-dev-plan.md).

## 폰(S25)에서 쓰기

1. PC에서 `start-phone.bat`을 더블클릭 (빌드 후 서버가 켜짐)
2. 처음 한 번 Windows 방화벽 창이 뜨면 **개인 네트워크 허용**
3. 같은 와이파이의 폰 크롬에서 창에 나온 `Network` 주소로 접속 (지금 PC는 `http://192.168.0.4:5173`)
4. 무음 모드여도 소리가 나도록 미디어 볼륨을 올려 주세요

지금은 http로 열리기 때문에 홈 화면 설치(오프라인)와 "영구 저장"은 안 돼요. 기록은 폰 브라우저에 쌓이니, 가끔 **설정 → 백업 내보내기**를 눌러 두세요. HTTPS로 올리면(GitHub Pages 등) 설치와 영구 저장이 켜집니다.

기록은 **기기별 브라우저에** 저장돼요. PC에서 푼 기록과 폰에서 푼 기록은 따로 쌓이고, 백업 내보내기/가져오기로 합칠 수 있어요.

## 개발

```bash
npm install
npm run dev:local   # PC 안에서만 (http://localhost:5173)
npm run dev         # 같은 와이파이의 폰에서도 접속
npm test            # 음악 이론, 멜로디 생성기, 키 판정, 적응형 출제 시뮬레이션
npm run build
```

## 구조

| 경로 | 내용 |
|---|---|
| `src/music/theory.ts` | 디그리, 스케일, 해결 선율 |
| `src/music/context.ts` | 맥락 풀 (카덴스, 드론, 스케일, 아르페지오; 보이싱·음역·최상단 음 무작위) |
| `src/music/melody.ts` | 전조를 피하는 멜로디 생성 + Krumhansl–Schmuckler 검증 |
| `src/audio/` | Web Audio 합성 음색 6종, 재생 엔진 |
| `src/session/question.ts` | 연속 기준음(±50센트), 랜덤/편향 문제 생성 |
| `src/adaptive/model.ts` | 4문제 블록(랜덤 2 + 편향 2), 약점 패턴 베타 모델, 톰슨 샘플링 |
| `src/adaptive/stats.ts` | 랜덤 vs 약점 비교, 찍기 보정(오경보율, d′), 반응 시간, 조건별 편차 |
| `src/data/db.ts` | IndexedDB 추가 전용 기록, gzip 보관, 백업 |
| `src/ui/` | 화면 (홈, 훈련, 통계, 설정, 밤하늘 배경) |
