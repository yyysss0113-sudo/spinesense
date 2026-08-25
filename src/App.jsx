import { useState, useCallback } from "react";

// ── 학교급·성별 실측 유병률 (7개년 224,630명 검진 데이터, %) ──
const OBSERVED_PREV = {
  "초": { "남": 0.22, "여": 0.20 },
  "중": { "남": 1.13, "여": 3.03 },
  "고": { "남": 1.77, "여": 3.18 },
};

// ── 로지스틱 회귀 계수 — 논문(epiH 2026) 최종 모델 aOR 기반 ──
// 여성 aOR 2.14 / 고교(vs 중학) 8.50/7.23 / 키 1.019/cm / BMI 0.89/kg·m²
// 수면 ≥7h 0.88 / 운동 주1-2일 0.91·주3-4일 0.88·주5일+ 0.79 (중·고 136,854명 민감도 모델)
// 절편은 7개년 검진 데이터(중·고 141,288명, 유병률 2.28%)로 보정
const LR = {
  b0:     -4.649644,          // 보정 절편 (기준: 남·중학·<7h 수면·운동 거의 안함; 실제 운동·수면 분포로 보정)
  gender: Math.log(2.14),     // 여성
  high:   Math.log(8.50/7.23),// 고등학교 (vs 중학교)
  height: Math.log(1.019),    // 키 +1cm당
  bmi:    Math.log(0.89),     // BMI +1kg/m²당
  sleep7: Math.log(0.88),     // 수면 7시간 이상 (보호)
  act:    [0, Math.log(0.91), Math.log(0.88), Math.log(0.79)], // 운동: 거의안함/주1-2일/주3-4일/주5일+
};

// ── 초등 전용 로지스틱 모델 (7개년 통합 원자료 자체 분석, n=81,288 · AIS 177건) ──
// 학년(초4 vs 초1) aOR 2.96 (p<0.001) / 운동 주3회+ aOR 0.68 (p=0.011) / 수면 ≥7h aOR 0.63 (p=0.047) — 유의
// 성별 0.83·키 1.00·BMI 0.96 — 미유의(보정 변수로만 포함)
const EL_LR = {
  b0:     -5.952033,
  female: -0.180927,
  g4:     +1.085546,   // 초3~6
  height: +0.004426,   // cm당
  bmi:    -0.040770,
  ex3:    -0.390734,   // 주 3회 이상 운동 (보호)
  sleep7: -0.457054,   // 수면 7시간 이상 (보호)
};

function calcElRisk(gender, grade, height, bmi, ex3, sleep7h) {
  const logit = EL_LR.b0
    + EL_LR.female * (gender === "여" ? 1 : 0)
    + EL_LR.g4     * (grade >= 3 ? 1 : 0)
    + EL_LR.height * height
    + EL_LR.bmi    * bmi
    + EL_LR.ex3    * (ex3 ? 1 : 0)
    + EL_LR.sleep7 * (sleep7h ? 1 : 0);
  return (1 / (1 + Math.exp(-logit))) * 100;
}
const NATIONAL_AVG = 1.51;

function calcRiskLR(gender, level, height, bmi, actLevel, sleep7h) {
  const logit = LR.b0
    + LR.gender * (gender === "여" ? 1 : 0)
    + LR.high   * (level === "고" ? 1 : 0)
    + LR.height * height
    + LR.bmi    * bmi
    + LR.sleep7 * (sleep7h ? 1 : 0)
    + LR.act[actLevel];
  return (1 / (1 + Math.exp(-logit))) * 100;
}

function getBmiCat(bmi) {
  if (bmi < 18.5) return "저체중";
  if (bmi < 23)   return "정상";
  if (bmi < 25)   return "과체중";
  return "비만";
}
const BMI_CAT_EN = { "저체중": "Underweight", "정상": "Normal", "과체중": "Overweight", "비만": "Obese" };

function getRiskLevel(pct, lang) {
  const en = lang === "en";
  if (pct >= 4.0) return { label: en ? "High" : "고위험", color: "#E63946", bg: "#fdecea", dot: "🔴" };
  if (pct >= 2.5) return { label: en ? "Caution" : "주의", color: "#d97706", bg: "#fff8ec", dot: "🟡" };
  return            { label: en ? "Low" : "낮음", color: "#028090", bg: "#e0f4f7", dot: "🟢" };
}

// 자가 체크리스트 5문항 (사진 촬영 대신 사용)
const SELF_CHECK_ITEMS = [
  { key: "shoulder",
    ko: "어깨 높이가 다른가요?",
    en: "Are your shoulders uneven in height?" },
  { key: "bend",
    ko: "허리를 앞으로 숙였을 때 등 한쪽이 더 높이 올라오나요?",
    en: "When you bend forward, does one side of your back rise higher?",
    noteKo: "Adam's Forward Bend Test 원리", noteEn: "Based on Adam's Forward Bend Test" },
  { key: "waist",
    ko: "허리·골반이 비대칭인가요?",
    en: "Are your waistline or hips asymmetric?" },
  { key: "clothes",
    ko: "옷이 자꾸 한쪽으로 쏠리나요?",
    en: "Do your clothes keep shifting to one side?" },
  { key: "leg",
    ko: "다리·바지 길이가 달라 보이나요?",
    en: "Do your legs or pant hems look uneven in length?" },
];

// ── 전체 UI 문구 (KO / EN) ──
const T = {
  ko: {
    title1: "AI 척추측만증 ", title2: "조기발견", title3: " 스크리너",
    subtitle: "전국 7개년 224,630명 검진 데이터 기반 · 교육용 선별 보조 도구 (의료기기 아님)",
    steps: ["정보 입력", "위험도 분석", "자세 체크", "AI 리포트"],
    introTitle: "검사 전에 1분만 읽어보세요",
    introQ1: "척추측만증이란?",
    introQ2: "왜 모르고 지나칠까요?",
    introQ3: "조기 발견이 왜 중요할까요?",
    introQ4: "학교 검진만으로 충분할까요?",
    lateTitle: "늦게 발견하면", earlyTitle: "일찍 발견하면",
    lateBody: "휜 각도 40도 이상 진행 시 폐 기능 저하·만성 통증, 수술까지 필요할 수 있어요",
    earlyBody: "수술 없이 보조기 착용만으로 더 휘어지는 것을 막을 수 있어요",
    tlGrades: ["초1", "초4", "중1", "고1"],
    tlGap: "⚠ 초4~중1 = 검진 공백 3년 (여학생 성장 급증기와 겹침)",
    startBtn: "검사 시작하기 →",
    introDisclaimer: "본 앱은 교육용 선별 보조 도구로, 의료기기가 아니며 의학적 진단을 대체할 수 없습니다",
    formTitle: "📋 기본 정보 입력",
    preNoticeTitle: "📋 이용 전 안내",
    preNotice1: "본 앱은 중고등학생이 개발한 ", preNoticeStrong: "교육용 선별 보조 도구", preNotice2: "입니다.",
    preNoticeL1: "· 의료기기가 아니며 의학적 진단을 대체할 수 없습니다",
    preNoticeL2: "· 국가 공공데이터(7개년 224,630명 검진) 기반 통계 참고용입니다",
    preNoticeL3: "· 결과와 무관하게 정확한 진단은 전문의 진료가 필요합니다",
    levelLabel: "학교급",
    levels: [["초", "초등학교"], ["중", "중학교"], ["고", "고등학교"]],
    gradeLabel: "학년",
    gradeName: (g) => `${g}학년`,
    gapZoneHint: "⚠ 초5·6은 국가 검진이 없는 공백 구간이에요 — 여학생 성장 급증기와 겹쳐 자가 점검이 특히 중요해요",
    genderLabel: "성별",
    genders: [["여", "여학생"], ["남", "남학생"]],
    exFreqLabel: "운동 빈도", exFreqHint: "(하루 30분 이상 운동한 날, 주당)",
    exOptions: [["0", "거의 안함"], ["1", "주 1~2일"], ["2", "주 3~4일"], ["3", "주 5일 이상"]],
    exElLabel: "운동 여부", exElHint: "(주 3회 이상 기준)",
    exElOptions: [["el_yes", "예 (주 3회 이상)"], ["el_no", "아니오 (거의 안함)"]],
    sleepLabel: "하루 수면량", sleepHint: "(평균 기준)",
    sleepOptions: [["ok", "7시간 이상"], ["short", "7시간 미만"]],
    elFactorNote: "※ 초등학생도 운동·수면이 위험도에 반영됩니다 (자체 분석: 운동 주3회+ 0.68배 · 수면 7시간+ 0.63배)",
    heightLabel: "키 (cm)", heightPh: "예: 158",
    weightLabel: "몸무게 (kg)", weightPh: "예: 46",
    bmiStandard: "BMI 기준: 대한비만학회 (2022) · 저체중 <18.5 / 정상 18.5~23 / 과체중 23~25 / 비만 ≥25",
    analyzeBtn: "위험도 분석하기 →",
    s1Title: "📊 통계 기반 위험도",
    s1SubEl: "7개년 224,630명 검진 데이터 · 초등 전용 회귀모델(81,288명 자체 분석) 기반",
    s1SubMh: "7개년 224,630명 검진 데이터 · 논문 회귀모델(중·고 136,854명) 기반",
    natAvg: "전국 평균",
    ofNatAvg: (x) => <>전국 평균의 <strong>{x}배</strong></>,
    badgeActivity: "⚠ 운동 부족 반영", badgeSleep: "⚠ 수면 부족 반영",
    elModelNote: <>초등학생 위험도는 <strong>초등 전용 회귀모델</strong>(7개년 원자료 81,288명 자체 분석) 기반입니다. 학년(초3~6 vs 초1·2 약 2.9배, p&lt;0.001), 운동 주3회 이상(0.68배, p=0.011), 수면 7시간 이상(0.63배, p=0.047)이 유의하게 반영됩니다.</>,
    gapBox: <><strong>⚠ 초5·6 = 국가 검진 공백 구간</strong><br />초4 이후 중1까지 3년간 학교 척추검진이 없어요. 이 구간에서 여학생 유병률은 0.29% → 3.03%로 10.3배 급등합니다. 초5·6은 검진 실측값이 없어 초4 기반 모델값을 표시하므로 <strong>하한선</strong>으로 보는 것이 안전하며, 다음 단계의 자가 체크를 꼭 해보세요.</>,
    barMine: "나의 위험도", barNat: "전국 평균",
    barGroup: (lv, gd) => `${lv}교 ${gd} 평균`,
    interp: (n) => <>나와 같은 조건의 학생 <strong style={{ color: "#0D2A4E" }}>100명 중 {n}명</strong>이 척추측만증 진단을 받았습니다.</>,
    nextPosture: "다음: 자세 분석 →", backHome: "← 처음으로",
    s2Title: "🧍 자세 자가 체크",
    s2Sub: "카메라 없이, 거울 앞에서 아래 5문항만 체크해보세요",
    s2Srs: <><strong>⚠ SRS(척추측만연구학회) 공인 표준 선별검사</strong>인 Adam's Forward Bend Test 원리를 적용한 자가 체크 문항입니다. 해당하는 항목을 모두 선택해주세요.</>,
    s2Rule: "하나라도 해당되면 '비대칭 의심'으로 판정되어 병원 방문을 권장하는 리포트를 받게 됩니다. 모두 해당 없음이면 '정상 범위'로 판정됩니다.",
    s2Btn: "결과 확인하기 →",
    s3Title: "🤖 AI 맞춤 리포트",
    s3Sub: "통계 위험도 + 자세 분석 결과 종합",
    s3Stat: "통계 위험도", s3Check: "자가 체크 결과",
    asymYes: "비대칭 의심", asymNo: "정상 범위",
    loading: "AI가 맞춤 리포트를 생성하고 있습니다...",
    s3Disclaimer: "⚠️ 이 결과는 의학적 진단이 아닌 선별 보조 정보입니다. 정확한 진단은 반드시 전문의 진료와 X-ray 검사를 통해 확인하세요.",
    restartBtn: "🔄 처음부터 다시 검사하기",
    reportError: (msg) => `리포트 생성 중 오류가 발생했습니다.\n\n${msg}\n\n네트워크 상태를 점검해주세요.`,
    footer1: "SpineSense · 제8회 교육 공공데이터 AI 활용대회 출품작",
    footer2: "교육부 학생건강검사 원시자료 7개년(2018~2025) 활용",
    levelName: { "초": "초등학교", "중": "중학교", "고": "고등학교" },
    genderName: { "여": "여", "남": "남" },
    bmiCatName: (c) => c,
  },
  en: {
    title1: "AI ", title2: "Early Detection", title3: " Scoliosis Screener",
    subtitle: "Built on 7 years of Korean national screening data (224,630 students) · Educational screening aid (not a medical device)",
    steps: ["Your Info", "Risk Estimate", "Posture Check", "AI Report"],
    introTitle: "One minute before you start",
    introQ1: "What is scoliosis?",
    introQ2: "Why does it go unnoticed?",
    introQ3: "Why does early detection matter?",
    introQ4: "Is school screening enough?",
    lateTitle: "Found late", earlyTitle: "Found early",
    lateBody: "Curves beyond 40° can reduce lung function, cause chronic pain, and may require surgery",
    earlyBody: "A brace alone can stop the curve from progressing — no surgery needed",
    tlGrades: ["G1", "G4", "G7", "G10"],
    tlGap: "⚠ G4 → G7 = a 3-year screening gap (overlapping girls' growth spurt)",
    startBtn: "Start Screening →",
    introDisclaimer: "This app is an educational screening aid. It is not a medical device and cannot replace a medical diagnosis.",
    formTitle: "📋 Basic Information",
    preNoticeTitle: "📋 Before you begin",
    preNotice1: "This app is an ", preNoticeStrong: "educational screening aid", preNotice2: " developed by a student.",
    preNoticeL1: "· Not a medical device; it cannot replace a medical diagnosis",
    preNoticeL2: "· Statistics are for reference, based on Korean national data (224,630 screenings over 7 years)",
    preNoticeL3: "· Regardless of the result, an accurate diagnosis requires a physician",
    levelLabel: "School level",
    levels: [["초", "Elementary"], ["중", "Middle school"], ["고", "High school"]],
    gradeLabel: "Grade",
    gradeName: (g) => `Grade ${g}`,
    gapZoneHint: "⚠ Grades 5–6 fall in the national screening gap — it overlaps girls' growth spurt, so self-checks matter most here",
    genderLabel: "Sex",
    genders: [["여", "Female"], ["남", "Male"]],
    exFreqLabel: "Physical activity", exFreqHint: "(days per week with 30+ min of exercise)",
    exOptions: [["0", "Rarely"], ["1", "1–2 days"], ["2", "3–4 days"], ["3", "5+ days"]],
    exElLabel: "Physical activity", exElHint: "(3+ times per week)",
    exElOptions: [["el_yes", "Yes (3+ / week)"], ["el_no", "No (rarely)"]],
    sleepLabel: "Daily sleep", sleepHint: "(on average)",
    sleepOptions: [["ok", "7 hours or more"], ["short", "Less than 7 hours"]],
    elFactorNote: "※ Exercise and sleep also affect the risk estimate for elementary students (our analysis: exercise 3+/wk ×0.68 · sleep 7h+ ×0.63)",
    heightLabel: "Height (cm)", heightPh: "e.g. 158",
    weightLabel: "Weight (kg)", weightPh: "e.g. 46",
    bmiStandard: "BMI categories: Korean Society for the Study of Obesity (2022) · Underweight <18.5 / Normal 18.5–23 / Overweight 23–25 / Obese ≥25",
    analyzeBtn: "Estimate My Risk →",
    s1Title: "📊 Statistical Risk Estimate",
    s1SubEl: "7-year national data (224,630 screenings) · elementary-specific regression model (n=81,288, our analysis)",
    s1SubMh: "7-year national data (224,630 screenings) · peer-reviewed regression model (n=136,854, middle/high school)",
    natAvg: "National average",
    ofNatAvg: (x) => <><strong>{x}×</strong> the national average</>,
    badgeActivity: "⚠ Low activity applied", badgeSleep: "⚠ Short sleep applied",
    elModelNote: <>Elementary risk comes from an <strong>elementary-specific regression model</strong> (our analysis of 81,288 raw records over 7 years). Grade 3–6 vs 1–2 (≈2.9×, p&lt;0.001), exercise 3+/week (×0.68, p=0.011), and sleep ≥7h (×0.63, p=0.047) are all statistically significant.</>,
    gapBox: <><strong>⚠ Grades 5–6 = national screening gap</strong><br />There is no school spine screening for 3 years between Grade 4 and Grade 7. Across this gap, prevalence among girls jumps 10.3-fold, from 0.29% to 3.03%. Since no screening data exist for Grades 5–6, the value shown is based on Grade 4 and is best read as a <strong>lower bound</strong> — please complete the self-check in the next step.</>,
    barMine: "My risk", barNat: "National average",
    barGroup: (lv, gd) => `${lv}, ${gd} average`,
    interp: (n) => <>Among 100 students with the same profile, about <strong style={{ color: "#0D2A4E" }}>{n} were diagnosed</strong> with scoliosis.</>,
    nextPosture: "Next: Posture Check →", backHome: "← Start over",
    s2Title: "🧍 Posture Self-Check",
    s2Sub: "No camera needed — just check these 5 items in front of a mirror",
    s2Srs: <><strong>⚠ Based on Adam's Forward Bend Test</strong>, the standard screening method endorsed by the Scoliosis Research Society (SRS). Select every item that applies to you.</>,
    s2Rule: "If any item applies, the result is 'possible asymmetry' and your report will recommend seeing a doctor. If none apply, the result is 'within normal range'.",
    s2Btn: "See My Results →",
    s3Title: "🤖 AI Personalized Report",
    s3Sub: "Combining your statistical risk and posture self-check",
    s3Stat: "Statistical risk", s3Check: "Self-check result",
    asymYes: "Possible asymmetry", asymNo: "Normal range",
    loading: "The AI is writing your personalized report...",
    s3Disclaimer: "⚠️ This result is screening support information, not a medical diagnosis. An accurate diagnosis requires a physician's exam and an X-ray.",
    restartBtn: "🔄 Start Over",
    reportError: (msg) => `Something went wrong while generating the report.\n\n${msg}\n\nPlease check your network connection.`,
    footer1: "SpineSense · Student project built on Korean public education data",
    footer2: "Korea MOE Student Health Examination raw data, 7 cycles (2018–2025)",
    levelName: { "초": "Elementary school", "중": "Middle school", "고": "High school" },
    genderName: { "여": "Female", "남": "Male" },
    bmiCatName: (c) => BMI_CAT_EN[c] || c,
  },
};

async function callClaude(profile, riskPct, checkedLabels, lang) {
  const asymmetryDetected = checkedLabels.length > 0;
  const en = lang === "en";

  const koPrompt = `당신은 척추측만증 선별검사 전문가입니다. 아래 학생 정보와 자가 체크리스트 응답을 분석하여 리포트를 작성하세요.

[학생 정보]
- 학교급: ${profile.level}학교${profile.level === "초" ? ` ${profile.grade}학년` : ""} / 성별: ${profile.gender}
- 키: ${profile.height}cm, 몸무게: ${profile.weight}kg
- BMI: ${profile.bmi.toFixed(1)} (${profile.bmiCat})
- 운동: ${profile.level === "초" ? (profile.elExercise ? "주 3회 이상" : "거의 안함 (주 3회 미만)") : `${["거의 안함", "주 1~2일", "주 3~4일", "주 5일 이상"][profile.actLevel]} (하루 30분 이상 기준)`}
- 수면: ${profile.shortSleep ? "부족 (7시간 미만)" : "충분 (7시간 이상)"}
- 통계 위험도: ${riskPct.toFixed(2)}% (전국 평균 ${NATIONAL_AVG}%의 ${(riskPct / NATIONAL_AVG).toFixed(1)}배)${profile.level === "초" ? `
- 초등 위험도는 초등 전용 회귀모델(7개년 원자료 81,288명 자체 분석) 기반. 학년(초3~6 vs 초1·2 약 2.9배)·운동 주3회 이상(0.68배)·수면 7시간 이상(0.63배)이 통계적으로 유의하게 반영됨. 운동·수면 개선이 실제 위험도를 낮추는 방향임을 생활습관 권고에 연결할 것` : ""}${profile.gapZone ? `
- ⚠ 이 학생은 초5·6 국가 검진 공백 구간에 있음. 여학생의 경우 이 구간에서 유병률이 초4 0.29%에서 중1 3.03%로 10.3배 급등하므로, 정기적 자가 점검과 보호자 관찰의 중요성을 리포트에 강조할 것` : ""}

[자가 체크리스트 결과 — Adam's Forward Bend Test 원리를 적용한 5문항 자가 점검]
- 판정: ${asymmetryDetected ? "비대칭 의심" : "정상"}
- 해당된 항목(${checkedLabels.length}개): ${checkedLabels.length > 0 ? checkedLabels.join(", ") : "없음"}

이 판정은 사진 분석이 아니라 학생이 거울 앞에서 스스로 응답한 체크리스트 결과이니, 그대로 사용하세요(직접 재판정하지 마세요).
"척추측만증입니다"라는 진단 표현은 절대 사용하지 마세요.
"2주 내", "즉시" 등 구체적 시기 표현은 사용하지 마세요. 대신 "정형외과를 방문해 척추 검사를 받아보시길 권장합니다"로 통일하세요.
다음 형식으로 작성하세요:

【자세 분석】
· 관찰 내용: (자가 체크 응답 요약)
· 판정: 비대칭 의심 / 정상 중 하나 (위에서 준 판정 그대로)

【종합 판정】
(한 문장 — 통계 위험도와 자가 체크 결과를 종합한 행동 권고)

【위험도 해석】
· 같은 조건 학생 100명 중 ${riskPct.toFixed(1)}명이 척추이상 진단
· 자가 체크 결과의 의미

【권고 사항】
· 행동 1: 정형외과를 방문해 척추 검사를 받아볼 것을 권장
· 행동 2: 생활 습관 개선
· 행동 3: 다음 검진 시기

【주의사항】
이 결과는 의학적 진단이 아닌 선별 보조 정보입니다. 정확한 진단은 전문의 진료와 X-ray 검사로 확인하세요.`;

  const enLevel = { "초": `Elementary school${profile.level === "초" ? `, Grade ${profile.grade}` : ""}`, "중": "Middle school", "고": "High school" }[profile.level];
  const enPrompt = `You are a scoliosis screening specialist. Write a report in English based on the student information and self-check responses below.

[Student information]
- School level: ${enLevel} / Sex: ${profile.gender === "여" ? "Female" : "Male"}
- Height: ${profile.height} cm, Weight: ${profile.weight} kg
- BMI: ${profile.bmi.toFixed(1)} (${BMI_CAT_EN[profile.bmiCat]})
- Physical activity: ${profile.level === "초" ? (profile.elExercise ? "3+ times per week" : "Rarely (less than 3 times per week)") : `${["Rarely", "1–2 days/week", "3–4 days/week", "5+ days/week"][profile.actLevel]} (30+ minutes per day)`}
- Sleep: ${profile.shortSleep ? "Insufficient (less than 7 hours)" : "Sufficient (7 hours or more)"}
- Statistical risk: ${riskPct.toFixed(2)}% (${(riskPct / NATIONAL_AVG).toFixed(1)}× the Korean national average of ${NATIONAL_AVG}%)${profile.level === "초" ? `
- The elementary risk comes from an elementary-specific regression model (our analysis of 81,288 raw records over 7 years). Grade 3–6 vs 1–2 (~2.9×), exercise 3+/week (×0.68), and sleep ≥7h (×0.63) are statistically significant. Connect exercise and sleep improvements to lower risk in the lifestyle recommendations.` : ""}${profile.gapZone ? `
- ⚠ This student is in the Grade 5–6 national screening gap. For girls, prevalence jumps 10.3-fold across this gap (0.29% at Grade 4 → 3.03% at Grade 7), so emphasize regular self-checks and parental observation.` : ""}

[Self-check results — a 5-item self-assessment based on Adam's Forward Bend Test]
- Determination: ${asymmetryDetected ? "Possible asymmetry" : "Normal"}
- Items that applied (${checkedLabels.length}): ${checkedLabels.length > 0 ? checkedLabels.join("; ") : "None"}

This determination comes from the student's own checklist responses in front of a mirror, not photo analysis — use it as given (do not re-judge it).
Never use diagnostic phrasing such as "You have scoliosis."
Never give specific timeframes such as "within 2 weeks" or "immediately." Instead, consistently say "We recommend visiting an orthopedic doctor for a spine examination."
Write in exactly this format:

【Posture Analysis】
· Observations: (summary of self-check responses)
· Determination: Possible asymmetry / Normal (exactly as given above)

【Overall Assessment】
(One sentence — an action recommendation combining the statistical risk and self-check result)

【Risk Interpretation】
· About ${riskPct.toFixed(1)} in 100 students with the same profile were diagnosed with a spinal abnormality
· What the self-check result means

【Recommendations】
· Action 1: We recommend visiting an orthopedic doctor for a spine examination (adjust to the risk level)
· Action 2: Lifestyle improvements
· Action 3: When to check again

【Important Note】
This result is screening support information, not a medical diagnosis. An accurate diagnosis requires a physician's exam and an X-ray.`;

  const res = await fetch("/api/claude", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      payload: {
        model: "claude-sonnet-4-6",
        max_tokens: 800,
        temperature: 0,
        messages: [{ role: "user", content: en ? enPrompt : koPrompt }],
      },
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `API ${en ? "error" : "오류"} (${res.status})`);
  }

  const data = await res.json();
  return data.content?.[0]?.text || (en ? "Failed to generate the report." : "리포트 생성에 실패했습니다.");
}

function Gauge({ pct, natLabel }) {
  const max = 6;
  const angle = Math.min((pct / max) * 180, 180);
  const r = 78, cx = 100, cy = 98;
  const toRad = (d) => (d * Math.PI) / 180;
  const arc = (s, e) => {
    const sr = toRad(180 + s), er = toRad(180 + e);
    const x1 = cx + r * Math.cos(sr), y1 = cy + r * Math.sin(sr);
    const x2 = cx + r * Math.cos(er), y2 = cy + r * Math.sin(er);
    return `M ${x1} ${y1} A ${r} ${r} 0 ${e - s > 90 ? 1 : 0} 1 ${x2} ${y2}`;
  };
  const nr = toRad(180 + angle);
  const nx = cx + 64 * Math.cos(nr), ny = cy + 64 * Math.sin(nr);
  const lv = getRiskLevel(pct, "ko");

  return (
    <svg viewBox="0 0 200 112" style={{ width: "100%", maxWidth: 240 }}>
      <path d={arc(0, 60)}   fill="none" stroke="#028090" strokeWidth="15" strokeLinecap="round" opacity="0.18" />
      <path d={arc(60, 110)} fill="none" stroke="#d97706" strokeWidth="15" strokeLinecap="round" opacity="0.18" />
      <path d={arc(110, 180)} fill="none" stroke="#E63946" strokeWidth="15" strokeLinecap="round" opacity="0.18" />
      {angle > 0 && <path d={arc(0, Math.min(angle, 60))} fill="none" stroke="#028090" strokeWidth="15" strokeLinecap="round" />}
      {angle > 60 && <path d={arc(60, Math.min(angle, 110))} fill="none" stroke="#d97706" strokeWidth="15" strokeLinecap="round" />}
      {angle > 110 && <path d={arc(110, angle)} fill="none" stroke="#E63946" strokeWidth="15" strokeLinecap="round" />}
      <line x1={cx} y1={cy} x2={nx} y2={ny} stroke={lv.color} strokeWidth="3" strokeLinecap="round" />
      <circle cx={cx} cy={cy} r="6" fill={lv.color} />
      <text x={cx} y={cy - 18} textAnchor="middle" fontSize="22" fontWeight="bold" fill={lv.color}>
        {pct.toFixed(2)}%
      </text>
      <text x={cx} y={cy - 5} textAnchor="middle" fontSize="9" fill="#94a3b8">
        {natLabel} {NATIONAL_AVG}%
      </text>
    </svg>
  );
}

function StepBar({ step, labels }) {
  return (
    <div style={{ display: "flex", alignItems: "center", marginBottom: 32 }}>
      {labels.map((s, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", flex: 1 }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: 1 }}>
            <div style={{
              width: 32, height: 32, borderRadius: "50%",
              background: i < step ? "#028090" : i === step ? "#0D2A4E" : "#e2e8f0",
              color: i <= step ? "#fff" : "#94a3b8",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 13, fontWeight: 700, transition: "all 0.3s",
            }}>
              {i < step ? "✓" : i + 1}
            </div>
            <span style={{
              fontSize: 10, marginTop: 4, textAlign: "center",
              color: i === step ? "#0D2A4E" : "#94a3b8",
              fontWeight: i === step ? 700 : 400,
            }}>{s}</span>
          </div>
          {i < labels.length - 1 && (
            <div style={{ height: 2, flex: 1, background: i < step ? "#028090" : "#e2e8f0", marginBottom: 18, transition: "background 0.3s" }} />
          )}
        </div>
      ))}
    </div>
  );
}

export default function App() {
  const [lang, setLang] = useState(() => {
    try { return new URLSearchParams(window.location.search).get("lang") === "en" ? "en" : "ko"; }
    catch { return "ko"; }
  });
  const [intro, setIntro] = useState(true);
  const [step, setStep] = useState(0);
  const [form, setForm] = useState({ level: "중", grade: null, gender: "여", height: "", weight: "", exercise: null, sleep: null });
  const [profile, setProfile] = useState(null);
  const [report, setReport] = useState("");
  const [loading, setLoading] = useState(false);
  const [asymmetryDetected, setAsymmetryDetected] = useState(false);
  const [checks, setChecks] = useState(() =>
    Object.fromEntries(SELF_CHECK_ITEMS.map((item) => [item.key, false]))
  );

  const t = T[lang];

  const toggleCheck = useCallback((key) => {
    setChecks((c) => ({ ...c, [key]: !c[key] }));
  }, []);

  const submit = () => {
    const h = parseFloat(form.height), w = parseFloat(form.weight);
    if (!h || !w || h < 100 || h > 220 || w < 20 || w > 150) return;
    const bmi = w / (h / 100) ** 2;
    const bmiCat = getBmiCat(bmi);
    const isEl = form.level === "초";
    const actLevel = isEl ? null : (form.exercise === null ? 0 : Number(form.exercise)); // 중·고 0~3
    const elExercise = isEl ? form.exercise === "el_yes" : null;   // 초등: 주3회 이상 여부
    const lowActivity = isEl ? !elExercise : actLevel <= 1;
    const shortSleep = form.sleep === "short";

    let riskPct, gapZone = false;
    if (form.level === "초") {
      const g = Number(form.grade);
      riskPct = calcElRisk(form.gender, g, h, bmi, elExercise, !shortSleep);
      gapZone = g >= 5;   // 초5·6 = 국가 검진 공백 구간
    } else {
      riskPct = calcRiskLR(form.gender, form.level, h, bmi, actLevel, !shortSleep);
    }
    setProfile({ ...form, bmi, bmiCat, riskPct, gapZone, actLevel, elExercise, lowActivity, shortSleep });
    setStep(1);
  };

  const submitSelfCheck = async () => {
    const checkedLabels = SELF_CHECK_ITEMS.filter((item) => checks[item.key]).map((item) => lang === "en" ? item.en : item.ko);
    const detected = checkedLabels.length > 0;
    setAsymmetryDetected(detected);
    setStep(3);
    setLoading(true);
    try {
      const text = await callClaude(profile, profile.riskPct, checkedLabels, lang);
      setReport(text);
    } catch (e) {
      setReport(t.reportError(e.message));
    }
    setLoading(false);
  };

  const reset = () => {
    setStep(0); setProfile(null); setReport("");
    setAsymmetryDetected(false);
    setChecks(Object.fromEntries(SELF_CHECK_ITEMS.map((item) => [item.key, false])));
  };

  const lv = profile ? getRiskLevel(profile.riskPct, lang) : null;
  const valid = form.height && form.weight
    && parseFloat(form.height) >= 100 && parseFloat(form.height) <= 220
    && parseFloat(form.weight) >= 20 && parseFloat(form.weight) <= 150
    && form.exercise !== null && form.sleep !== null
    && (form.level !== "초" || form.grade !== null);

  const S = {
    page: { minHeight: "100vh", background: "linear-gradient(150deg, #f0f7ff 0%, #e4f0fb 100%)", fontFamily: "'Segoe UI', Tahoma, sans-serif", padding: "28px 16px" },
    card: { background: "#fff", borderRadius: 22, boxShadow: "0 6px 32px rgba(13,42,78,0.10)", padding: "30px 26px", maxWidth: 500, margin: "0 auto" },
    btn: (active, color = "#0D2A4E") => ({
      width: "100%", padding: "13px", borderRadius: 12, border: "none",
      background: active ? color : "#e2e8f0",
      color: active ? "#fff" : "#94a3b8",
      fontSize: 15, fontWeight: 700,
      cursor: active ? "pointer" : "not-allowed",
      transition: "all 0.2s",
    }),
    toggle: (sel) => ({
      flex: 1, padding: "10px 0", borderRadius: 10,
      border: `2px solid ${sel ? "#0D2A4E" : "#e2e8f0"}`,
      background: sel ? "#0D2A4E" : "#fff",
      color: sel ? "#fff" : "#64748b",
      fontWeight: 700, fontSize: 14, cursor: "pointer",
    }),
    label: { fontSize: 11, fontWeight: 700, color: "#64748b", display: "block", marginBottom: 7 },
    input: { width: "100%", padding: "12px 14px", borderRadius: 10, border: "2px solid #e2e8f0", fontSize: 16, outline: "none", boxSizing: "border-box", marginBottom: 16 },
  };

  const langBtn = (code, label) => (
    <button onClick={() => setLang(code)} style={{
      padding: "4px 12px", borderRadius: 99, fontSize: 11, fontWeight: 700, cursor: "pointer",
      border: `1.5px solid ${lang === code ? "#028090" : "#cbd5e1"}`,
      background: lang === code ? "#028090" : "#fff",
      color: lang === code ? "#fff" : "#64748b",
    }}>{label}</button>
  );

  return (
    <div style={S.page}>
      <div style={{ maxWidth: 500, margin: "0 auto 10px", display: "flex", justifyContent: "flex-end", gap: 6 }}>
        {langBtn("ko", "한국어")}
        {langBtn("en", "English")}
      </div>

      <div style={{ textAlign: "center", marginBottom: 24 }}>
        <div style={{ fontSize: 11, letterSpacing: 4, color: "#028090", fontWeight: 800 }}>SPINESENSE</div>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: "#0D2A4E", margin: "4px 0" }}>
          {t.title1}<span style={{ color: "#E63946" }}>{t.title2}</span>{t.title3}
        </h1>
        <p style={{ color: "#94a3b8", fontSize: 11, margin: "4px 0 0" }}>{t.subtitle}</p>
      </div>

      <div style={S.card}>
        {intro && (
          <div>
            <div style={{ textAlign: "center", marginBottom: 18 }}>
              <div style={{ fontSize: 40, marginBottom: 6 }}>🦴</div>
              <h2 style={{ fontSize: 18, color: "#0D2A4E", fontWeight: 800, margin: 0 }}>{t.introTitle}</h2>
            </div>

            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: "#028090", marginBottom: 6 }}>{t.introQ1}</div>
              <p style={{ fontSize: 12.5, color: "#334155", lineHeight: 1.75, margin: 0 }}>
                {lang === "ko" ? (
                  <>척추(등뼈)가 정면에서 봤을 때 C자나 S자 모양으로 옆으로 휘어진 상태로, 10도 이상 휘면
                  척추측만증으로 진단합니다. <strong>청소년기에 가장 흔한 척추 질환</strong>으로, 전국 검진
                  데이터에서 100명 중 1~2명(1.51%)이 진단을 받았습니다. 대부분 정확한 원인을 알 수 없고(특발성),
                  키가 한창 크는 성장기에 갑자기 진행되는 경우가 많습니다.</>
                ) : (
                  <>Scoliosis is a sideways, C- or S-shaped curve of the spine, diagnosed when the curve
                  exceeds 10 degrees. It is <strong>the most common spinal condition in adolescence</strong> —
                  in Korean national screening data, 1–2 in 100 students (1.51%) were diagnosed. In most cases
                  the cause is unknown (idiopathic), and it often progresses suddenly during growth spurts.</>
                )}
              </p>
            </div>

            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: "#028090", marginBottom: 6 }}>{t.introQ2}</div>
              <p style={{ fontSize: 12.5, color: "#334155", lineHeight: 1.75, margin: 0 }}>
                {lang === "ko" ? (
                  <>초기에는 <strong>통증이 없고 겉으로도 잘 보이지 않아</strong> 본인도 가족도 모르는 사이에
                  진행됩니다. 특히 키가 빨리 크는 시기(여학생은 초4~중1)에 짧은 기간 동안 빠르게 심해질 수 있습니다.</>
                ) : (
                  <>In its early stages scoliosis <strong>causes no pain and is hard to see</strong>, so it
                  progresses without the student or family noticing. It can worsen quickly during rapid growth —
                  for girls, especially between Grades 4 and 7.</>
                )}
              </p>
            </div>

            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: "#028090", marginBottom: 8 }}>{t.introQ3}</div>
              <div style={{ display: "flex", gap: 8 }}>
                <div style={{ flex: 1, background: "#fdecea", borderRadius: 10, padding: "10px 12px" }}>
                  <div style={{ fontSize: 11, fontWeight: 800, color: "#E63946", marginBottom: 4 }}>{t.lateTitle}</div>
                  <div style={{ fontSize: 11.5, color: "#7f1d1d", lineHeight: 1.6 }}>{t.lateBody}</div>
                </div>
                <div style={{ flex: 1, background: "#e0f4f7", borderRadius: 10, padding: "10px 12px" }}>
                  <div style={{ fontSize: 11, fontWeight: 800, color: "#028090", marginBottom: 4 }}>{t.earlyTitle}</div>
                  <div style={{ fontSize: 11.5, color: "#134e4a", lineHeight: 1.6 }}>{t.earlyBody}</div>
                </div>
              </div>
            </div>

            <div style={{ marginBottom: 18 }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: "#028090", marginBottom: 6 }}>{t.introQ4}</div>
              <p style={{ fontSize: 12.5, color: "#334155", lineHeight: 1.75, margin: "0 0 10px" }}>
                {lang === "ko" ? (
                  <>국가 척추검진은 <strong>초1·초4·중1·고1</strong> 네 학년에서만 이뤄져, 초4와 중1 사이에
                  <strong> 3년의 공백</strong>이 있습니다. 이 공백이 여학생의 성장 급증기와 겹쳐 유병률이
                  0.29%에서 3.03%로 <strong>10.3배</strong> 뛰어오릅니다. 그래서 검진 사이사이,
                  스스로 확인하는 습관이 필요합니다.</>
                ) : (
                  <>Korea's national spine screening covers only four grades — <strong>1, 4, 7, and 10</strong> —
                  leaving a <strong>3-year gap</strong> between Grades 4 and 7. That gap overlaps girls' growth
                  spurt, and prevalence jumps <strong>10.3-fold</strong>, from 0.29% to 3.03%. That is why
                  a habit of self-checking between screenings matters.</>
                )}
              </p>
              <div style={{ background: "#f8fafc", borderRadius: 10, padding: "10px 12px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 0 }}>
                  {t.tlGrades.map((g, i) => (
                    <div key={g} style={{ display: "flex", alignItems: "center", flex: i === 0 ? "0 0 auto" : 1 }}>
                      {i > 0 && (
                        <div style={{ flex: 1, height: 3, borderRadius: 2, background: i === 2
                          ? "repeating-linear-gradient(135deg,#f3b8a6,#f3b8a6 3px,#fde3d8 3px,#fde3d8 6px)"
                          : "#cbd5e1" }} />
                      )}
                      <div style={{ fontSize: 10.5, fontWeight: 700, color: "#0D2A4E", background: "#fff",
                        border: "1.5px solid #94a3b8", borderRadius: 99, padding: "3px 9px", whiteSpace: "nowrap" }}>{g}</div>
                    </div>
                  ))}
                </div>
                <div style={{ fontSize: 10, color: "#b4512f", fontWeight: 700, marginTop: 6, textAlign: "center" }}>{t.tlGap}</div>
              </div>
            </div>

            <button onClick={() => setIntro(false)} style={S.btn(true)}>{t.startBtn}</button>
            <p style={{ fontSize: 10, color: "#94a3b8", textAlign: "center", marginTop: 10, lineHeight: 1.6, marginBottom: 0 }}>
              {t.introDisclaimer}
            </p>
          </div>
        )}

        {!intro && <StepBar step={step} labels={t.steps} />}

        {!intro && step === 0 && (
          <div>
            <h2 style={{ fontSize: 17, color: "#0D2A4E", marginBottom: 20, fontWeight: 700 }}>{t.formTitle}</h2>

            <div style={{ background: "#fff8ec", border: "1.5px solid #d97706", borderRadius: 12, padding: "14px 16px", marginBottom: 18, fontSize: 11, color: "#92400e", lineHeight: 1.8 }}>
              <strong>{t.preNoticeTitle}</strong><br />
              {t.preNotice1}<strong>{t.preNoticeStrong}</strong>{t.preNotice2}<br />
              {t.preNoticeL1}<br />
              {t.preNoticeL2}<br />
              {t.preNoticeL3}
            </div>

            <label style={S.label}>{t.levelLabel}</label>
            <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
              {t.levels.map(([v, txt]) => (
                <button key={v} onClick={() => setForm(f => ({ ...f, level: v, exercise: null, grade: null }))} style={S.toggle(form.level === v)}>{txt}</button>
              ))}
            </div>

            {form.level === "초" && (
              <div style={{ marginBottom: 18 }}>
                <label style={S.label}>{t.gradeLabel}</label>
                <div style={{ display: "flex", gap: 6 }}>
                  {[1, 2, 3, 4, 5, 6].map((g) => (
                    <button key={g} onClick={() => setForm(f => ({ ...f, grade: g }))}
                      style={{ ...S.toggle(form.grade === g), fontSize: lang === "en" ? 10.5 : 13, borderColor: form.grade === g ? (g >= 5 ? "#d97706" : "#0D2A4E") : "#e2e8f0", background: form.grade === g ? (g >= 5 ? "#d97706" : "#0D2A4E") : "#fff" }}>
                      {t.gradeName(g)}
                    </button>
                  ))}
                </div>
                {form.grade >= 5 && (
                  <div style={{ fontSize: 10, color: "#d97706", marginTop: 5, lineHeight: 1.5 }}>{t.gapZoneHint}</div>
                )}
              </div>
            )}

            <label style={S.label}>{t.genderLabel}</label>
            <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
              {t.genders.map(([v, txt]) => (
                <button key={v} onClick={() => setForm(f => ({ ...f, gender: v }))} style={S.toggle(form.gender === v)}>{txt}</button>
              ))}
            </div>

            {(form.level === "중" || form.level === "고") ? (
              <div style={{ marginBottom: 18 }}>
                <label style={S.label}>{t.exFreqLabel} <span style={{ fontSize: 10, color: "#94a3b8", fontWeight: 400, marginLeft: 6 }}>{t.exFreqHint}</span></label>
                <div style={{ display: "flex", gap: 6 }}>
                  {t.exOptions.map(([v, txt]) => (
                    <button key={v} onClick={() => setForm(f => ({ ...f, exercise: v }))}
                      style={{ ...S.toggle(form.exercise === v), fontSize: 12, borderColor: form.exercise === v ? (Number(v) <= 1 ? "#E63946" : "#028090") : "#e2e8f0", background: form.exercise === v ? (Number(v) <= 1 ? "#E63946" : "#028090") : "#fff" }}>
                      {txt}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div style={{ marginBottom: 18 }}>
                <label style={S.label}>{t.exElLabel} <span style={{ fontSize: 10, color: "#94a3b8", fontWeight: 400, marginLeft: 6 }}>{t.exElHint}</span></label>
                <div style={{ display: "flex", gap: 8 }}>
                  {t.exElOptions.map(([v, txt]) => (
                    <button key={v} onClick={() => setForm(f => ({ ...f, exercise: v }))}
                      style={{ ...S.toggle(form.exercise === v), borderColor: form.exercise === v ? (v === "el_no" ? "#E63946" : "#028090") : "#e2e8f0", background: form.exercise === v ? (v === "el_no" ? "#E63946" : "#028090") : "#fff" }}>
                      {txt}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div style={{ marginBottom: 18 }}>
              <label style={S.label}>{t.sleepLabel} <span style={{ fontSize: 10, color: "#94a3b8", fontWeight: 400, marginLeft: 6 }}>{t.sleepHint}</span></label>
              <div style={{ display: "flex", gap: 8 }}>
                {t.sleepOptions.map(([v, txt]) => (
                  <button key={v} onClick={() => setForm(f => ({ ...f, sleep: v }))}
                    style={{ ...S.toggle(form.sleep === v), borderColor: form.sleep === v ? (v === "short" ? "#d97706" : "#028090") : "#e2e8f0", background: form.sleep === v ? (v === "short" ? "#d97706" : "#028090") : "#fff" }}>
                    {txt}
                  </button>
                ))}
              </div>
              {form.level === "초" && (
                <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 5, lineHeight: 1.5 }}>{t.elFactorNote}</div>
              )}
            </div>

            <label style={S.label}>{t.heightLabel}</label>
            <input type="number" placeholder={t.heightPh} value={form.height}
              onChange={e => setForm(f => ({ ...f, height: e.target.value }))} style={S.input} />

            <label style={S.label}>{t.weightLabel}</label>
            <input type="number" placeholder={t.weightPh} value={form.weight}
              onChange={e => setForm(f => ({ ...f, weight: e.target.value }))} style={{ ...S.input, marginBottom: 0 }} />

            {form.height && form.weight && parseFloat(form.height) >= 100 && parseFloat(form.weight) >= 20 && (
              <div style={{ background: "#f0f7ff", borderRadius: 10, padding: "10px 14px", margin: "12px 0 4px", fontSize: 13, color: "#64748b" }}>
                BMI: <strong style={{ color: "#0D2A4E" }}>
                  {(parseFloat(form.weight) / (parseFloat(form.height) / 100) ** 2).toFixed(1)}
                </strong>
                {" "}({t.bmiCatName(getBmiCat(parseFloat(form.weight) / (parseFloat(form.height) / 100) ** 2))})
              </div>
            )}
            <div style={{ fontSize: 10, color: "#94a3b8", marginBottom: 18, paddingLeft: 2 }}>{t.bmiStandard}</div>

            <button onClick={submit} style={{ ...S.btn(valid), marginTop: 8 }}>{t.analyzeBtn}</button>
          </div>
        )}

        {!intro && step === 1 && profile && (
          <div>
            <h2 style={{ fontSize: 17, color: "#0D2A4E", marginBottom: 4, fontWeight: 700 }}>{t.s1Title}</h2>
            <p style={{ fontSize: 11, color: "#94a3b8", marginBottom: 18 }}>{profile.level === "초" ? t.s1SubEl : t.s1SubMh}</p>

            <div style={{ textAlign: "center", marginBottom: 16 }}>
              <Gauge pct={profile.riskPct} natLabel={t.natAvg} />
            </div>

            <div style={{ background: lv.bg, border: `2px solid ${lv.color}`, borderRadius: 14, padding: "14px 18px", marginBottom: 20, textAlign: "center" }}>
              <div style={{ fontSize: 26, fontWeight: 800, color: lv.color }}>{lv.dot} {lv.label}</div>
              <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>
                {t.levelName[profile.level]} · {t.genderName[profile.gender]} · {t.bmiCatName(profile.bmiCat)} ·{" "}
                <span style={{ color: lv.color }}>{t.ofNatAvg((profile.riskPct / NATIONAL_AVG).toFixed(1))}</span>
              </div>
              {profile.lowActivity && (
                <div style={{ marginTop: 8, fontSize: 11, background: "#fdecea", borderRadius: 8, padding: "5px 10px", color: "#E63946", display: "inline-block", fontWeight: 600, marginRight: 6 }}>
                  {t.badgeActivity}
                </div>
              )}
              {profile.shortSleep && (
                <div style={{ marginTop: 8, fontSize: 11, background: "#fff8ec", borderRadius: 8, padding: "5px 10px", color: "#d97706", display: "inline-block", fontWeight: 600 }}>
                  {t.badgeSleep}
                </div>
              )}
            </div>

            {profile.level === "초" && (
              <div style={{ background: "#f8fafc", borderRadius: 10, padding: "10px 14px", fontSize: 11, color: "#64748b", lineHeight: 1.7, marginBottom: 14 }}>
                {t.elModelNote}
              </div>
            )}

            {profile.gapZone && (
              <div style={{ background: "#fff8ec", border: "1.5px solid #d97706", borderRadius: 10, padding: "12px 14px", fontSize: 11, color: "#92400e", lineHeight: 1.7, marginBottom: 14 }}>
                {t.gapBox}
              </div>
            )}

            <div style={{ marginBottom: 18 }}>
              {[
                { label: t.barMine, pct: profile.riskPct, color: lv.color },
                { label: t.barNat, pct: NATIONAL_AVG, color: "#94a3b8" },
                { label: t.barGroup(t.levelName[profile.level], t.genderName[profile.gender]), pct: OBSERVED_PREV[profile.level][profile.gender], color: "#1D6FA4" },
              ].map(({ label, pct, color }) => (
                <div key={label} style={{ marginBottom: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
                    <span style={{ color: "#64748b" }}>{label}</span>
                    <span style={{ color, fontWeight: 700 }}>{pct.toFixed(2)}%</span>
                  </div>
                  <div style={{ background: "#f1f5f9", borderRadius: 99, height: 8 }}>
                    <div style={{ width: `${Math.min(pct / 6 * 100, 100)}%`, height: "100%", background: color, borderRadius: 99, transition: "width 1s" }} />
                  </div>
                </div>
              ))}
            </div>

            <div style={{ background: "#f8fafc", borderRadius: 10, padding: "12px 14px", fontSize: 12, color: "#64748b", lineHeight: 1.8, marginBottom: 20 }}>
              {t.interp(profile.riskPct.toFixed(1))}
            </div>

            <button onClick={() => setStep(2)} style={S.btn(true)}>{t.nextPosture}</button>
            <button onClick={reset} style={{ width: "100%", padding: "10px", marginTop: 8, borderRadius: 12, border: "2px solid #e2e8f0", background: "#fff", color: "#64748b", fontSize: 14, cursor: "pointer" }}>
              {t.backHome}
            </button>
          </div>
        )}

        {!intro && step === 2 && (
          <div>
            <h2 style={{ fontSize: 17, color: "#0D2A4E", marginBottom: 4, fontWeight: 700 }}>{t.s2Title}</h2>
            <p style={{ fontSize: 11, color: "#94a3b8", marginBottom: 14 }}>{t.s2Sub}</p>

            <div style={{ background: "#fff8ec", border: "1.5px solid #d97706", borderRadius: 12, padding: "12px 14px", marginBottom: 14, fontSize: 11, color: "#92400e", lineHeight: 1.7 }}>
              {t.s2Srs}
            </div>

            <div style={{ marginBottom: 18 }}>
              {SELF_CHECK_ITEMS.map((item) => (
                <button
                  key={item.key}
                  onClick={() => toggleCheck(item.key)}
                  style={{
                    display: "flex", alignItems: "flex-start", gap: 10, width: "100%",
                    textAlign: "left", padding: "12px 14px", marginBottom: 8,
                    borderRadius: 12, cursor: "pointer",
                    border: `2px solid ${checks[item.key] ? "#028090" : "#e2e8f0"}`,
                    background: checks[item.key] ? "#e0f4f7" : "#fff",
                  }}
                >
                  <div style={{
                    width: 20, height: 20, borderRadius: 6, flexShrink: 0, marginTop: 1,
                    border: `2px solid ${checks[item.key] ? "#028090" : "#cbd5e1"}`,
                    background: checks[item.key] ? "#028090" : "#fff",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 12, color: "#fff", fontWeight: 700,
                  }}>
                    {checks[item.key] ? "✓" : ""}
                  </div>
                  <div>
                    <div style={{ fontSize: 13, color: "#1e293b", fontWeight: 600, lineHeight: 1.5 }}>{lang === "en" ? item.en : item.ko}</div>
                    {(lang === "en" ? item.noteEn : item.noteKo) && (
                      <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 2 }}>{lang === "en" ? item.noteEn : item.noteKo}</div>
                    )}
                  </div>
                </button>
              ))}
            </div>

            <div style={{ background: "#f8fafc", borderRadius: 10, padding: "10px 14px", fontSize: 11, color: "#64748b", lineHeight: 1.6, marginBottom: 16 }}>
              {t.s2Rule}
            </div>

            <button onClick={submitSelfCheck} style={S.btn(true)}>{t.s2Btn}</button>
          </div>
        )}

        {!intro && step === 3 && (
          <div>
            <h2 style={{ fontSize: 17, color: "#0D2A4E", marginBottom: 4, fontWeight: 700 }}>{t.s3Title}</h2>
            <p style={{ fontSize: 11, color: "#94a3b8", marginBottom: 16 }}>{t.s3Sub}</p>

            <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
              <div style={{ flex: 1, background: lv?.bg, borderRadius: 12, padding: "12px", textAlign: "center" }}>
                <div style={{ fontSize: 10, color: "#64748b", marginBottom: 3 }}>{t.s3Stat}</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: lv?.color }}>{profile?.riskPct.toFixed(2)}%</div>
                <div style={{ fontSize: 10, color: lv?.color, fontWeight: 700 }}>{lv?.label}</div>
              </div>
              <div style={{ flex: 1, background: asymmetryDetected ? "#fdecea" : "#e0f4f7", borderRadius: 12, padding: "12px", textAlign: "center" }}>
                <div style={{ fontSize: 10, color: "#64748b", marginBottom: 3 }}>{t.s3Check}</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: asymmetryDetected ? "#E63946" : "#028090" }}>
                  {asymmetryDetected ? "⚠" : "✓"}
                </div>
                <div style={{ fontSize: 10, color: asymmetryDetected ? "#E63946" : "#028090", fontWeight: 700 }}>
                  {asymmetryDetected ? t.asymYes : t.asymNo}
                </div>
              </div>
            </div>

            {loading ? (
              <div style={{ textAlign: "center", padding: "40px 0" }}>
                <div style={{ fontSize: 36, marginBottom: 12, display: "inline-block", animation: "spin 1.2s linear infinite" }}>⚙️</div>
                <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
                <div style={{ color: "#64748b", fontSize: 14 }}>{t.loading}</div>
              </div>
            ) : (
              <div style={{ background: "#f8fafc", borderRadius: 14, padding: "18px", fontSize: 13, color: "#1e293b", lineHeight: 1.9, whiteSpace: "pre-wrap", marginBottom: 16, maxHeight: 340, overflowY: "auto", border: "1px solid #e2e8f0" }}>
                {report}
              </div>
            )}

            <div style={{ background: "#fff8ec", border: "1px solid #d97706", borderRadius: 10, padding: "10px 14px", fontSize: 11, color: "#92400e", lineHeight: 1.7, marginBottom: 18 }}>
              {t.s3Disclaimer}
            </div>

            <button onClick={reset} style={S.btn(true)}>{t.restartBtn}</button>
          </div>
        )}
      </div>

      <div style={{ textAlign: "center", marginTop: 24, fontSize: 10, color: "#94a3b8", lineHeight: 1.8 }}>
        {t.footer1}<br />
        {t.footer2}
      </div>
    </div>
  );
}
