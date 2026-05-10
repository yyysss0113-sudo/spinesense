# SpineSense 배포 가이드

## Vercel 배포 (가장 빠름, 무료)

### 방법 1: 드래그앤드롭 (5분)
1. https://vercel.com 접속 → GitHub 회원가입
2. 대시보드에서 "Add New → Project" 클릭
3. "Import Git Repository" 대신 **"Deploy without Git"** 선택
4. 이 폴더(spinesense/)를 ZIP으로 압축해서 업로드
5. Build Command: `npm run build`
6. Output Directory: `dist`
7. Deploy 클릭 → 1분 후 URL 발급!

### 방법 2: GitHub 연동 (10분, 권장)
1. GitHub 회원가입 → New Repository → "spinesense"
2. 이 폴더의 파일들을 업로드
3. Vercel에서 해당 레포 선택 → 자동 배포

## 앱 사용 방법
1. 배포된 URL 접속
2. Anthropic API 키 입력 (https://console.anthropic.com 에서 발급)
3. 정보 입력 → 위험도 확인 → 자세 분석 → AI 리포트

## 파일 구조
```
spinesense/
├── index.html
├── package.json
├── vite.config.js
├── vercel.json
└── src/
    ├── main.jsx
    └── App.jsx   ← 핵심 앱 코드
```

## 기술 스택
- React 18 + Vite
- Claude API (claude-sonnet-4-20250514)
- 5개년 158,245명 실측 위험도 룩업 테이블
- MediaPipe Pose (전문 버전 확장 예정)
