import { useState, useRef, useCallback, useEffect } from "react";

// ── 전국 가중 유병률 룩업 테이블 (7개년 실측) ──
const RISK_TABLE = {
  "중": { "남": {1:1.29,2:1.35,3:1.41,4:1.47}, "여": {1:3.46,2:3.52,3:3.58,4:3.64} },
  "고": { "남": {1:2.34,2:2.40,3:2.46,4:2.52}, "여": {1:3.60,2:3.66,3:3.72,4:3.78} },
  "초": { "남": {1:0.28,2:0.28,3:0.28,4:0.28}, "여": {1:0.26,2:0.26,3:0.26,4:0.26} },
};

// ── 로지스틱 회귀 모델 계수 (중·고등학생 137,318명, 7개년, 비가중) ──
// 학교급 대신 키(10cm 단위)를 성장 지표로 사용 (AIC 28,520)
// logit = β0 + β_gender×여성 + β_height×(키/10) + β_bmi×BMI + β_ex×운동부재 + β_sleep×수면부족
const LR = {
  b0:     -5.665115,  // 절편
  gender: +0.802120,  // 여성=1 (aOR 2.230) ★★★
  height: +0.220602,  // 키 +10cm당 (aOR 1.247) ★★★
  bmi:    -0.114226,  // BMI +1 — 높을수록 보호 (aOR 0.892) ★★★
  exer:   +0.131874,  // 운동부재=1 (aOR 1.141) ★★
  sleep:  +0.194508,  // 수면부족=1 (aOR 1.215) ★★★
};

// 초등학생 룩업 테이블 (운동·수면 데이터 없어 실측값 사용)
const RISK_TABLE_EL = {
  여: { 저체중: 0.18, 정상: 0.25, 과체중: 0.47, 비만: 0.19 },
  남: { 저체중: 0.23, 정상: 0.21, 과체중: 0.26, 비만: 0.19 },
};
const NATIONAL_AVG = 1.51;

// BMI 코드: 저체중=0, 정상=1, 과체중=2, 비만=3
function getBmiCode(bmi) {
  if (bmi < 18.5) return 0;
  if (bmi < 23)   return 1;
  if (bmi < 25)   return 2;
  return 3;
}

// 로지스틱 회귀로 위험도 계산 (중·고) — BMI 실제값 사용
function calcRiskLR(gender, height, bmi, noExercise, shortSleep) {
  const logit = LR.b0
    + LR.gender * (gender === "여" ? 1 : 0)
    + LR.height * (height / 10)       // 키 cm → 10cm 단위
    + LR.bmi    * bmi                  // BMI 실제값
    + LR.exer   * (noExercise ? 1 : 0)
    + LR.sleep  * (shortSleep ? 1 : 0);
  return (1 / (1 + Math.exp(-logit))) * 100;
}

// BMI 카테고리 라벨 (표시용)
function getBmiCat(bmi) {
  if (bmi < 18.5) return "저체중";
  if (bmi < 23)   return "정상";
  if (bmi < 25)   return "과체중";
  return "비만";
}

const BMI_STANDARD = "BMI 기준: 대한비만학회 (2022) · 저체중 <18.5 / 정상 18.5~23 / 과체중 23~25 / 비만 ≥25";

function getRiskLevel(pct) {
  if (pct >= 4.0) return { label: "고위험", color: "#E63946", bg: "#fdecea", dot: "🔴", eng: "HIGH" };
  if (pct >= 2.5) return { label: "주의",   color: "#d97706", bg: "#fff8ec", dot: "🟡", eng: "CAUTION" };
  return            { label: "낮음",   color: "#028090", bg: "#e0f4f7", dot: "🟢", eng: "LOW" };
}

// ── 이미지 압축 (API 전송용) ──
async function compressImage(dataUrl, maxWidth = 800, quality = 0.7) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      const ratio = Math.min(maxWidth / img.width, maxWidth / img.height, 1);
      canvas.width = img.width * ratio;
      canvas.height = img.height * ratio;
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.src = dataUrl;
  });
}

// ── Claude API 호출 (Vision 포함) ──
async function callClaude(apiKey, profile, riskPct, photoSrc) {
  const method = profile.level === "초"
    ? "초등학교 실측 유병률 룩업"
    : "로지스틱 회귀 (성별·키(성장지표)·BMI·운동·수면 동시 반영)";

  const textPrompt = `당신은 척추 건강 선별 안내 전문가입니다. 아래 학생 정보와 첨부된 자세 사진을 함께 분석하여 맞춤형 척추 건강 안내 리포트를 작성해주세요.

[학생 정보]
- 학교급: ${profile.level}학교 / 성별: ${profile.gender}
- 키: ${profile.height}cm, 몸무게: ${profile.weight}kg
- BMI: ${profile.bmi.toFixed(1)} (${profile.bmiCat})
- 운동 여부: ${profile.noExercise ? "운동 부재 (주 3회 미만)" : "운동함 (주 3회 이상)"}
- 수면량: ${profile.shortSleep ? "수면 부족 (6시간 이하)" : "충분 (7시간 이상)"}
- 분석 방법: ${method}
- 통계 위험도: ${riskPct.toFixed(2)}% (전국 평균 ${NATIONAL_AVG}%의 ${(riskPct / NATIONAL_AVG).toFixed(1)}배)

[자세 사진 분석 지침]
첨부된 사진은 Adams Forward Bend Test (앞으로 숙이기 검사) 사진입니다.
뒤에서 촬영한 사진에서 다음을 확인하세요:
- 좌우 어깨 높이 차이
- 등(흉곽) 좌우 돌출 비대칭
- 전체적인 척추 정렬 상태

다음 형식으로 간결하게 작성하세요:

【자세 분석】
· 사진에서 관찰된 좌우 비대칭 여부와 정도 (정상/경미/뚜렷)

【종합 판정】
(한 문장 — 병원 방문 권고 여부 포함)

【위험도 해석】
· 나와 같은 조건 학생 100명 중 몇 명이 진단받았는지 설명
· 자세 분석 결과가 의미하는 것

【권고 사항】
· 구체적 행동 1 (병원 방문 여부)
· 구체적 행동 2 (생활 습관)
· 구체적 행동 3 (다음 검진 시기)

【주의사항】
이 결과는 의학적 진단이 아닌 선별 보조 정보입니다. 정확한 진단은 전문의 진료와 X-ray 검사를 통해 확인하세요.

※ "척추측만증입니다"라는 진단 표현은 절대 사용하지 마세요.`;

  // 사진이 있으면 Vision, 없으면 텍스트만
  const messageContent = photoSrc
    ? [
        { type: "image", source: { type: "base64", media_type: "image/jpeg",
            data: photoSrc.replace(/^data:image\/\w+;base64,/, "") } },
        { type: "text", text: textPrompt },
      ]
    : textPrompt;

  // Netlify 함수를 프록시로 사용 (CORS 우회)
  const res = await fetch("/api/claude", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      apiKey,
      payload: {
        model: "claude-sonnet-4-6",
        max_tokens: 800,
        messages: [{ role: "user", content: messageContent }],
      },
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `API 오류 (${res.status})`);
  }

  const data = await res.json();
  return data.content?.[0]?.text || "리포트 생성에 실패했습니다.";
}

// ── 반원 게이지 ──
function Gauge({ pct }) {
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
  const lv = getRiskLevel(pct);

  return (
    <svg viewBox="0 0 200 112" style={{ width: "100%", maxWidth: 240 }}>
      {/* 배경 트랙 */}
      <path d={arc(0, 60)}   fill="none" stroke="#028090" strokeWidth="15" strokeLinecap="round" opacity="0.18" />
      <path d={arc(60, 110)} fill="none" stroke="#d97706" strokeWidth="15" strokeLinecap="round" opacity="0.18" />
      <path d={arc(110, 180)} fill="none" stroke="#E63946" strokeWidth="15" strokeLinecap="round" opacity="0.18" />
      {/* 채워진 트랙 */}
      {angle > 0 && <path d={arc(0, Math.min(angle, 60))} fill="none" stroke="#028090" strokeWidth="15" strokeLinecap="round" />}
      {angle > 60 && <path d={arc(60, Math.min(angle, 110))} fill="none" stroke="#d97706" strokeWidth="15" strokeLinecap="round" />}
      {angle > 110 && <path d={arc(110, angle)} fill="none" stroke="#E63946" strokeWidth="15" strokeLinecap="round" />}
      {/* 바늘 */}
      <line x1={cx} y1={cy} x2={nx} y2={ny} stroke={lv.color} strokeWidth="3" strokeLinecap="round" />
      <circle cx={cx} cy={cy} r="6" fill={lv.color} />
      {/* 수치 */}
      <text x={cx} y={cy - 18} textAnchor="middle" fontSize="22" fontWeight="bold" fill={lv.color}>
        {pct.toFixed(2)}%
      </text>
      <text x={cx} y={cy - 5} textAnchor="middle" fontSize="9" fill="#94a3b8">
        전국 평균 {NATIONAL_AVG}%
      </text>
    </svg>
  );
}

// ── 단계 표시줄 ──
function StepBar({ step }) {
  const steps = ["정보 입력", "위험도 분석", "자세 체크", "AI 리포트"];
  return (
    <div style={{ display: "flex", alignItems: "center", marginBottom: 32 }}>
      {steps.map((s, i) => (
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
          {i < steps.length - 1 && (
            <div style={{ height: 2, flex: 1, background: i < step ? "#028090" : "#e2e8f0", marginBottom: 18, transition: "background 0.3s" }} />
          )}
        </div>
      ))}
    </div>
  );
}

// ── 메인 앱 ──
export default function App() {
  // API 키 (세션스토리지 유지)
  const [apiKey, setApiKey] = useState(() => sessionStorage.getItem("ss_apikey") || "");
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [keySet, setKeySet] = useState(() => !!sessionStorage.getItem("ss_apikey"));

  const saveKey = () => {
    const k = apiKeyInput.trim();
    if (!k.startsWith("sk-ant-")) return alert("올바른 Anthropic API 키를 입력해주세요 (sk-ant-... 형태)");
    sessionStorage.setItem("ss_apikey", k);
    setApiKey(k);
    setKeySet(true);
  };

  const [step, setStep] = useState(0);
  const [form, setForm] = useState({ level: "중", gender: "여", height: "", weight: "", exercise: null, sleep: null });
  const [profile, setProfile] = useState(null);
  const [asymmetry, setAsymmetry] = useState(null);
  const [report, setReport] = useState("");
  const [loading, setLoading] = useState(false);
  const [photoSrc, setPhotoSrc] = useState(null);
  const [capturing, setCapturing] = useState(false);
  const [poseResult, setPoseResult] = useState(null); // { diff: number, label: string }
  const [analyzing, setAnalyzing] = useState(false);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const fileInputRef = useRef(null);
  const imgRef = useRef(null);

  // MediaPipe로 어깨 높이 차이 자동 분석
  const analyzePosture = useCallback(async (src) => {
    setAnalyzing(true);
    setPoseResult(null);
    try {
      const Pose = window.Pose;
      if (!Pose) throw new Error("MediaPipe 로드 안 됨");

      const pose = new Pose({ locateFile: (f) =>
        `https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.5.1675469404/${f}` });
      pose.setOptions({ modelComplexity: 1, smoothLandmarks: false, minDetectionConfidence: 0.5 });

      await new Promise((resolve, reject) => {
        pose.onResults((results) => {
          const lm = results.poseLandmarks;
          if (!lm) { reject(new Error("포즈 미감지")); return; }
          // 11=왼쪽 어깨, 12=오른쪽 어깨 (y값: 0=상단, 1=하단)
          const leftY  = lm[11].y;
          const rightY = lm[12].y;
          const diffPct = Math.abs(leftY - rightY) * 100;
          const higher = leftY < rightY ? "왼쪽" : "오른쪽";
          const label = diffPct < 1.5 ? "정상" : diffPct < 3.5 ? "경미한 비대칭" : "뚜렷한 비대칭";
          setPoseResult({ diff: diffPct.toFixed(1), higher, label,
            detected: diffPct >= 1.5 ? "감지" : "정상" });
          resolve();
        });

        const img = new Image();
        img.onload = () => pose.send({ image: img });
        img.onerror = reject;
        img.src = src;
      });
    } catch {
      // MediaPipe 실패 시 수동 선택 모드로 fallback
      setPoseResult({ error: true });
    } finally {
      setAnalyzing(false);
    }
  }, []);

  const startCapture = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      streamRef.current = stream;
      setCapturing(true);
    } catch {
      fileInputRef.current?.click();
    }
  }, []);

  useEffect(() => {
    if (capturing && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
    }
  }, [capturing]);

  const takePhoto = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d").drawImage(video, 0, 0);
    const dataUrl = canvas.toDataURL("image/jpeg");
    setPhotoSrc(dataUrl);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    setCapturing(false);
    analyzePosture(dataUrl); // 자동 분석 시작
  }, [analyzePosture]);

  const retakePhoto = useCallback(() => {
    setPhotoSrc(null);
    setCapturing(false);
    setPoseResult(null);
  }, []);

  const handleFileUpload = useCallback((e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setPhotoSrc(ev.target.result);
      analyzePosture(ev.target.result); // 자동 분석 시작
    };
    reader.readAsDataURL(file);
  }, [analyzePosture]);

  useEffect(() => () => streamRef.current?.getTracks().forEach((t) => t.stop()), []);

  const submit = () => {
    const h = parseFloat(form.height), w = parseFloat(form.weight);
    if (!h || !w || h < 100 || h > 220 || w < 20 || w > 150) return;
    const bmi = w / (h / 100) ** 2;
    const bmiCat = getBmiCat(bmi);
    const noExercise = form.exercise === "no";
    const shortSleep = form.sleep === "short";

    let riskPct;
    if (form.level === "초") {
      riskPct = RISK_TABLE_EL[form.gender]?.[bmiCat] ?? NATIONAL_AVG;
    } else {
      // 중·고: 로지스틱 회귀 — 키(10cm 단위) 성장 지표 + BMI 실제값
      riskPct = calcRiskLR(form.gender, h, bmi, noExercise, shortSleep);
    }
    setProfile({ ...form, bmi, bmiCat, riskPct, noExercise, shortSleep });
    setStep(1);
  };

  const pickAsymmetry = async (photo) => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    setAsymmetry("vision");
    setStep(3);
    setLoading(true);
    try {
      // 사진 압축 후 전송 (용량 축소)
      const compressed = photo ? await compressImage(photo, 800, 0.7) : null;
      const text = await callClaude(apiKey, profile, profile.riskPct, compressed);
      setReport(text);
    } catch (e) {
      setReport(`리포트 생성 중 오류가 발생했습니다.\n\n${e.message}\n\nAPI 키를 확인하거나 네트워크 상태를 점검해주세요.`);
    }
    setLoading(false);
  };

  const reset = () => {
    setStep(0); setProfile(null); setAsymmetry(null); setReport(""); setPhotoSrc(null); setPoseResult(null); streamRef.current?.getTracks().forEach((t) => t.stop());
  };

  const lv = profile ? getRiskLevel(profile.riskPct) : null;
  const valid = form.height && form.weight
    && parseFloat(form.height) >= 100 && parseFloat(form.height) <= 220
    && parseFloat(form.weight) >= 20 && parseFloat(form.weight) <= 150
    && (form.level === "초" || (form.exercise !== null && form.sleep !== null));

  // 공통 스타일
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

  // ── API 키 설정 화면 ──
  if (!keySet) {
    return (
      <div style={S.page}>
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div style={{ fontSize: 11, letterSpacing: 4, color: "#028090", fontWeight: 800 }}>SPINESENSE</div>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: "#0D2A4E", margin: "6px 0" }}>
            AI 척추측만증 <span style={{ color: "#E63946" }}>조기발견</span> 스크리너
          </h1>
        </div>
        <div style={S.card}>
          <div style={{ textAlign: "center", marginBottom: 24 }}>
            <div style={{ fontSize: 40, marginBottom: 8 }}>🔑</div>
            <h2 style={{ fontSize: 17, color: "#0D2A4E", margin: "0 0 8px" }}>Anthropic API 키 입력</h2>
            <p style={{ fontSize: 12, color: "#64748b", lineHeight: 1.6, margin: 0 }}>
              AI 리포트 생성을 위해 Claude API 키가 필요합니다.<br />
              키는 이 브라우저 세션에만 저장되며 외부로 전송되지 않습니다.
            </p>
          </div>
          <div style={{ background: "#f8fafc", borderRadius: 10, padding: "12px 14px", marginBottom: 16, fontSize: 12, color: "#64748b", lineHeight: 1.7 }}>
            📌 <strong>API 키 발급 방법</strong><br />
            1. <a href="https://console.anthropic.com" target="_blank" rel="noreferrer" style={{ color: "#028090" }}>console.anthropic.com</a> 접속<br />
            2. 회원가입 → API Keys → Create Key<br />
            3. "sk-ant-..."로 시작하는 키 복사
          </div>
          <input
            type="password"
            placeholder="sk-ant-api03-..."
            value={apiKeyInput}
            onChange={(e) => setApiKeyInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && saveKey()}
            style={{ ...S.input, fontFamily: "monospace", fontSize: 13 }}
          />
          <button onClick={saveKey} style={S.btn(apiKeyInput.length > 10)}>
            시작하기 →
          </button>
          <p style={{ fontSize: 10, color: "#94a3b8", textAlign: "center", marginTop: 12, lineHeight: 1.5 }}>
            ※ API 키는 sessionStorage에만 저장되며 브라우저 종료 시 삭제됩니다
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={S.page}>
      {/* 헤더 */}
      <div style={{ textAlign: "center", marginBottom: 24 }}>
        <div style={{ fontSize: 11, letterSpacing: 4, color: "#028090", fontWeight: 800 }}>SPINESENSE</div>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: "#0D2A4E", margin: "4px 0" }}>
          AI 척추측만증 <span style={{ color: "#E63946" }}>조기발견</span> 스크리너
        </h1>
        <p style={{ color: "#94a3b8", fontSize: 11, margin: "4px 0 0" }}>
          전국 7개년 137,318명 실측 데이터 기반 · 의학적 선별 보조 도구
        </p>
      </div>

      <div style={S.card}>
        <StepBar step={step} />

        {/* ══ STEP 0: 정보 입력 ══ */}
        {step === 0 && (
          <div>
            <h2 style={{ fontSize: 17, color: "#0D2A4E", marginBottom: 20, fontWeight: 700 }}>📋 기본 정보 입력</h2>

            {/* 학교급 */}
            <label style={S.label}>학교급</label>
            <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
              {[["초", "초등학교"], ["중", "중학교"], ["고", "고등학교"]].map(([v, t]) => (
                <button key={v} onClick={() => setForm(f => ({ ...f, level: v }))} style={S.toggle(form.level === v)}>{t}</button>
              ))}
            </div>

            {/* 성별 */}
            <label style={S.label}>성별</label>
            <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
              {[["여", "여학생"], ["남", "남학생"]].map(([v, t]) => (
                <button key={v} onClick={() => setForm(f => ({ ...f, gender: v }))} style={S.toggle(form.gender === v)}>{t}</button>
              ))}
            </div>

            {/* 운동 — 중·고만 표시 */}
            {(form.level === "중" || form.level === "고") && (
              <div style={{ marginBottom: 18 }}>
                <label style={S.label}>
                  운동 여부
                  <span style={{ fontSize: 10, color: "#94a3b8", fontWeight: 400, marginLeft: 6 }}>
                    (하루 30분 이상, 주 3회 기준)
                  </span>
                </label>
                <div style={{ display: "flex", gap: 8 }}>
                  {[["yes", "예 (운동함)"], ["no", "아니오 (거의 안함)"]].map(([v, t]) => (
                    <button key={v} onClick={() => setForm(f => ({ ...f, exercise: v }))}
                      style={{
                        ...S.toggle(form.exercise === v),
                        borderColor: form.exercise === v ? (v === "no" ? "#E63946" : "#028090") : "#e2e8f0",
                        background: form.exercise === v ? (v === "no" ? "#E63946" : "#028090") : "#fff",
                      }}>
                      {t}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* 수면 — 중·고만 표시 */}
            {(form.level === "중" || form.level === "고") && (
              <div style={{ marginBottom: 18 }}>
                <label style={S.label}>
                  하루 수면량
                  <span style={{ fontSize: 10, color: "#94a3b8", fontWeight: 400, marginLeft: 6 }}>
                    (평균 기준)
                  </span>
                </label>
                <div style={{ display: "flex", gap: 8 }}>
                  {[["ok", "7시간 이상"], ["short", "6시간 이하"]].map(([v, t]) => (
                    <button key={v} onClick={() => setForm(f => ({ ...f, sleep: v }))}
                      style={{
                        ...S.toggle(form.sleep === v),
                        borderColor: form.sleep === v ? (v === "short" ? "#d97706" : "#028090") : "#e2e8f0",
                        background: form.sleep === v ? (v === "short" ? "#d97706" : "#028090") : "#fff",
                      }}>
                      {t}
                    </button>
                  ))}
                </div>
                {form.sleep === "short" && (
                  <div style={{ fontSize: 10, color: "#d97706", marginTop: 5 }}>
                    ⚠ 수면 부족은 척추측만 위험을 약 1.14배 높이는 위험인자입니다
                  </div>
                )}
              </div>
            )}

            {/* 키 */}
            <label style={S.label}>키 (cm)</label>
            <input type="number" placeholder="예: 158" value={form.height}
              onChange={e => setForm(f => ({ ...f, height: e.target.value }))} style={S.input} />

            {/* 몸무게 */}
            <label style={S.label}>몸무게 (kg)</label>
            <input type="number" placeholder="예: 46" value={form.weight}
              onChange={e => setForm(f => ({ ...f, weight: e.target.value }))} style={{ ...S.input, marginBottom: 0 }} />

            {/* BMI 미리보기 */}
            {form.height && form.weight && parseFloat(form.height) >= 100 && parseFloat(form.weight) >= 20 && (
              <div style={{ background: "#f0f7ff", borderRadius: 10, padding: "10px 14px", margin: "12px 0 4px", fontSize: 13, color: "#64748b" }}>
                BMI: <strong style={{ color: "#0D2A4E" }}>
                  {(parseFloat(form.weight) / (parseFloat(form.height) / 100) ** 2).toFixed(1)}
                </strong>
                {" "}({getBmiCat(parseFloat(form.weight) / (parseFloat(form.height) / 100) ** 2)})
              </div>
            )}
            <div style={{ fontSize: 10, color: "#94a3b8", marginBottom: 18, paddingLeft: 2 }}>
              {BMI_STANDARD}
            </div>

            <button onClick={submit} style={{ ...S.btn(valid), marginTop: 8 }}>
              위험도 분석하기 →
            </button>
          </div>
        )}

        {/* ══ STEP 1: 위험도 결과 ══ */}
        {step === 1 && profile && (
          <div>
            <h2 style={{ fontSize: 17, color: "#0D2A4E", marginBottom: 4, fontWeight: 700 }}>📊 통계 기반 위험도</h2>
            <p style={{ fontSize: 11, color: "#94a3b8", marginBottom: 18 }}>7개년 137,318명 실측 데이터 기반</p>

            {/* 게이지 */}
            <div style={{ textAlign: "center", marginBottom: 16 }}>
              <Gauge pct={profile.riskPct} />
            </div>

            {/* 레벨 뱃지 */}
            <div style={{ background: lv.bg, border: `2px solid ${lv.color}`, borderRadius: 14, padding: "14px 18px", marginBottom: 20, textAlign: "center" }}>
              <div style={{ fontSize: 26, fontWeight: 800, color: lv.color }}>{lv.dot} {lv.label}</div>
              <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>
                {profile.level}학교 {profile.gender} · {profile.bmiCat} ·
                전국 평균의 <strong style={{ color: lv.color }}>{(profile.riskPct / NATIONAL_AVG).toFixed(1)}배</strong>
              </div>
              {profile.noExercise && (
                <div style={{ marginTop: 8, fontSize: 11, background: "#fdecea", borderRadius: 8, padding: "5px 10px", color: "#E63946", display: "inline-block", fontWeight: 600, marginRight: 6 }}>
                  ⚠ 운동 부재 반영
                </div>
              )}
              {profile.shortSleep && (
                <div style={{ marginTop: 8, fontSize: 11, background: "#fff8ec", borderRadius: 8, padding: "5px 10px", color: "#d97706", display: "inline-block", fontWeight: 600 }}>
                  ⚠ 수면 부족 반영
                </div>
              )}
              {(profile.level !== "초") && (
                <div style={{ marginTop: 8, fontSize: 10, color: "#94a3b8" }}>
                  ※ 로지스틱 회귀 (성별·학교급·BMI·운동·수면 5개 변수 동시 반영)
                </div>
              )}
            </div>

            {/* 비교 바 */}
            <div style={{ marginBottom: 18 }}>
              {[
                { label: "나의 위험도", pct: profile.riskPct, color: lv.color },
                { label: "전국 평균", pct: NATIONAL_AVG, color: "#94a3b8" },
                { label: `${profile.level}교 ${profile.gender} 평균`, pct: Object.values(RISK_TABLE[profile.level][profile.gender]).reduce((a, b) => a + b) / 4, color: "#1D6FA4" },
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

            {/* 해석 */}
            <div style={{ background: "#f8fafc", borderRadius: 10, padding: "12px 14px", fontSize: 12, color: "#64748b", lineHeight: 1.8, marginBottom: 20 }}>
              나와 같은 조건의 학생{" "}
              <strong style={{ color: "#0D2A4E" }}>100명 중 {profile.riskPct.toFixed(1)}명</strong>이
              척추측만증 진단을 받았습니다. 수치가 높을수록 정밀 검진이 권장됩니다.
            </div>

            <button onClick={() => { setStep(2); }} style={S.btn(true)}>
              다음: 자세 분석 →
            </button>
            <button onClick={reset}
              style={{ width: "100%", padding: "10px", marginTop: 8, borderRadius: 12, border: "2px solid #e2e8f0", background: "#fff", color: "#64748b", fontSize: 14, cursor: "pointer" }}>
              ← 처음으로
            </button>
          </div>
        )}

        {/* ══ STEP 2: Adam's Test ══ */}
        {step === 2 && (
          <div>
            <h2 style={{ fontSize: 17, color: "#0D2A4E", marginBottom: 4, fontWeight: 700 }}>📱 Adam's Forward Bend Test</h2>
            <p style={{ fontSize: 11, color: "#94a3b8", marginBottom: 14 }}>SRS(척추측만연구학회) 공인 표준 선별검사</p>

            {/* 촬영 전 체크리스트 */}
            <div style={{ background: "#fff8ec", border: "1.5px solid #d97706", borderRadius: 12, padding: "12px 14px", marginBottom: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#d97706", marginBottom: 10 }}>
                ⚠ 촬영 전 필수 확인 — 정확한 AI 판독을 위해
              </div>
              {[
                { ok: true,  label: "복장",   text: "타이트한 옷 또는 민소매 (헐렁한 옷 착용 시 오인식)" },
                { ok: true,  label: "머리",   text: "머리카락 묶기 (어깨·등이 완전히 드러나야 함)" },
                { ok: true,  label: "배경",   text: "흰 벽 등 단색 배경 앞에 서기" },
                { ok: true,  label: "조명",   text: "형광등 등 균일한 실내 조명 (역광·창가 X)" },
                { ok: true,  label: "거리",   text: "등 뒤 정면 1.5~2m 거리에서 촬영" },
                { ok: true,  label: "안정",   text: "셀프타이머 3초 사용 (흔들림 → 오측정)" },
              ].map((item, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 7 }}>
                  <div style={{
                    width: 22, height: 22, borderRadius: "50%", flexShrink: 0,
                    background: "#028090",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 10, fontWeight: 700, color: "#fff",
                  }}>O</div>
                  <div>
                    <span style={{ fontSize: 10, fontWeight: 700, color: "#d97706", marginRight: 5 }}>[{item.label}]</span>
                    <span style={{ fontSize: 11, color: "#1e293b" }}>{item.text}</span>
                  </div>
                </div>
              ))}
            </div>

            {/* 촬영 방향 안내 — 핵심 배너 */}
            <div style={{ background: "#0D2A4E", borderRadius: 12, padding: "14px 16px", marginBottom: 14, textAlign: "center" }}>
              <div style={{ fontSize: 20, marginBottom: 6 }}>🧍‍♀️ → 📸</div>
              <div style={{ fontSize: 14, fontWeight: 800, color: "#fff", marginBottom: 4 }}>
                등 뒤에서 찍으세요!
              </div>
              <div style={{ fontSize: 12, color: "#94d8e0", lineHeight: 1.6 }}>
                검사받는 사람이 <strong style={{ color: "#fff" }}>앞으로 90도 숙인 자세</strong>를 취한 후<br />
                <strong style={{ color: "#fff" }}>뒤에서 1.5~2m 거리</strong>에서 촬영하세요
              </div>
            </div>

            {/* 자세 안내 */}
            <div style={{ background: "#e0f4f7", borderRadius: 12, padding: "12px 14px", marginBottom: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#028090", marginBottom: 8 }}>📋 촬영 순서</div>
              {[
                "검사받는 사람이 등을 카메라 쪽으로 향해 서기",
                "발을 어깨 너비로 벌리고 무릎을 편 채로 앞으로 90도 숙이기",
                "팔은 자연스럽게 아래로 늘어뜨리기",
                "뒤에서 등 좌우 높이 차이가 보이면 사진 촬영",
              ].map((t, i) => (
                <div key={i} style={{ display: "flex", gap: 8, marginBottom: 6, fontSize: 12, color: "#0D2A4E", alignItems: "flex-start" }}>
                  <span style={{ background: "#028090", color: "#fff", borderRadius: "50%", width: 18, height: 18, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, flexShrink: 0, marginTop: 1 }}>{i + 1}</span>
                  {t}
                </div>
              ))}
            </div>

            {/* 사진 촬영 영역 */}
            <div style={{ position: "relative", borderRadius: 16, overflow: "hidden", background: "#1a2636", marginBottom: 16, aspectRatio: "4/3" }}>
              {/* 숨긴 캔버스 (스냅샷용) */}
              <canvas ref={canvasRef} style={{ display: "none" }} />
              {/* 숨긴 파일 입력 */}
              <input ref={fileInputRef} type="file" accept="image/*" capture="environment"
                style={{ display: "none" }} onChange={handleFileUpload} />

              {/* 촬영 전 */}
              {!capturing && !photoSrc && (
                <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10 }}>
                  <div style={{ fontSize: 44 }}>📷</div>
                  <div style={{ color: "#64748b", fontSize: 13, textAlign: "center", padding: "0 20px" }}>
                    사진을 찍어서 어깨 비대칭을 확인하세요
                  </div>
                  <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
                    <button onClick={startCapture}
                      style={{ padding: "10px 18px", borderRadius: 10, border: "none", background: "#028090", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                      📸 카메라로 찍기
                    </button>
                    <button onClick={() => fileInputRef.current?.click()}
                      style={{ padding: "10px 18px", borderRadius: 10, border: "2px solid #028090", background: "transparent", color: "#028090", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                      🖼 사진 올리기
                    </button>
                  </div>
                </div>
              )}

              {/* 촬영 중 (라이브뷰) */}
              {capturing && (
                <>
                  <video ref={videoRef} autoPlay playsInline muted
                    style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  <div style={{ position: "absolute", bottom: 16, left: 0, right: 0, display: "flex", justifyContent: "center" }}>
                    <button onClick={takePhoto}
                      style={{ width: 64, height: 64, borderRadius: "50%", border: "4px solid #fff", background: "#028090", cursor: "pointer", fontSize: 22 }}>
                      📸
                    </button>
                  </div>
                </>
              )}

              {/* 촬영된 사진 */}
              {photoSrc && (
                <>
                  <img src={photoSrc} alt="촬영 사진"
                    style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  <button onClick={retakePhoto}
                    style={{ position: "absolute", top: 10, right: 10, padding: "6px 12px", borderRadius: 8, border: "none", background: "rgba(0,0,0,0.6)", color: "#fff", fontSize: 12, cursor: "pointer" }}>
                    다시 찍기
                  </button>
                  <div style={{ position: "absolute", bottom: 10, left: 0, right: 0, textAlign: "center" }}>
                    <span style={{ background: "rgba(2,128,144,0.85)", color: "#fff", fontSize: 12, padding: "6px 14px", borderRadius: 99 }}>
                      어깨 높이 차이를 확인하세요 ↓
                    </span>
                  </div>
                </>
              )}
            </div>

            {/* AI 자동 분석 결과 */}
            {photoSrc && (
              <div style={{ marginBottom: 14 }}>
                {/* 사진 찍으면 바로 AI 리포트 버튼 표시 */}
                {photoSrc && (
                  <div style={{ marginTop: 12 }}>
                    <div style={{ background: "#e0f4f7", borderRadius: 12, padding: "14px", textAlign: "center", marginBottom: 12 }}>
                      <div style={{ fontSize: 13, color: "#028090", fontWeight: 700, marginBottom: 4 }}>
                        📸 사진이 준비됐습니다
                      </div>
                      <div style={{ fontSize: 11, color: "#475569" }}>
                        Claude AI가 사진을 보고 어깨 비대칭을 직접 분석합니다
                      </div>
                    </div>
                    <button onClick={() => pickAsymmetry(photoSrc)}
                      style={{ width: "100%", padding: "14px", borderRadius: 12, border: "none", background: "#028090", color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
                      🤖 AI 자세 분석 + 리포트 받기 →
                    </button>
                  </div>
                )}
              </div>
            )}

            <div style={{ fontSize: 10, color: "#94a3b8", textAlign: "center", lineHeight: 1.6, marginTop: 8 }}>
              ※ Claude AI가 사진을 직접 분석하여 어깨 비대칭 여부를 판단합니다
            </div>
          </div>
        )}

        {/* ══ STEP 3: AI 리포트 ══ */}
        {step === 3 && (
          <div>
            <h2 style={{ fontSize: 17, color: "#0D2A4E", marginBottom: 4, fontWeight: 700 }}>🤖 AI 맞춤 리포트</h2>
            <p style={{ fontSize: 11, color: "#94a3b8", marginBottom: 16 }}>통계 위험도 + 자세 분석 결과 종합</p>

            {/* 요약 카드 */}
            <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
              <div style={{ flex: 1, background: lv?.bg, borderRadius: 12, padding: "12px", textAlign: "center" }}>
                <div style={{ fontSize: 10, color: "#64748b", marginBottom: 3 }}>통계 위험도</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: lv?.color }}>{profile?.riskPct.toFixed(2)}%</div>
                <div style={{ fontSize: 10, color: lv?.color, fontWeight: 700 }}>{lv?.label}</div>
              </div>
              <div style={{ flex: 1, background: asymmetry === "감지" ? "#fdecea" : "#e0f4f7", borderRadius: 12, padding: "12px", textAlign: "center" }}>
                <div style={{ fontSize: 10, color: "#64748b", marginBottom: 3 }}>자세 분석</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: asymmetry === "감지" ? "#E63946" : "#028090" }}>
                  {asymmetry === "감지" ? "⚠" : "✓"}
                </div>
                <div style={{ fontSize: 10, color: asymmetry === "감지" ? "#E63946" : "#028090", fontWeight: 700 }}>
                  {asymmetry === "감지" ? "비대칭 감지" : "정상 범위"}
                </div>
              </div>
            </div>

            {/* 리포트 */}
            {loading ? (
              <div style={{ textAlign: "center", padding: "40px 0" }}>
                <div style={{ fontSize: 36, marginBottom: 12, display: "inline-block", animation: "spin 1.2s linear infinite" }}>⚙️</div>
                <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
                <div style={{ color: "#64748b", fontSize: 14 }}>AI가 맞춤 리포트를 생성하고 있습니다...</div>
              </div>
            ) : (
              <div style={{
                background: "#f8fafc", borderRadius: 14, padding: "18px",
                fontSize: 13, color: "#1e293b", lineHeight: 1.9,
                whiteSpace: "pre-wrap", marginBottom: 16,
                maxHeight: 340, overflowY: "auto",
                border: "1px solid #e2e8f0",
              }}>
                {report}
              </div>
            )}

            {/* 면책 */}
            <div style={{ background: "#fff8ec", border: "1px solid #d97706", borderRadius: 10, padding: "10px 14px", fontSize: 11, color: "#92400e", lineHeight: 1.7, marginBottom: 18 }}>
              ⚠️ 이 결과는 의학적 진단이 아닌 선별 보조 정보입니다.
              정확한 진단은 반드시 전문의 진료와 X-ray 검사를 통해 확인하세요.
            </div>

            <button onClick={reset} style={S.btn(true)}>
              🔄 처음부터 다시 검사하기
            </button>
          </div>
        )}
      </div>

      {/* 푸터 */}
      <div style={{ textAlign: "center", marginTop: 24, fontSize: 10, color: "#94a3b8", lineHeight: 1.8 }}>
        SpineSense · 제8회 교육 공공데이터 AI 활용대회 출품작<br />
        교육부 학생건강검사 표본조사 원시자료 (2019–2024) 활용<br />
        <button onClick={() => { sessionStorage.removeItem("ss_apikey"); setKeySet(false); setApiKey(""); }}
          style={{ background: "none", border: "none", color: "#94a3b8", cursor: "pointer", fontSize: 10, textDecoration: "underline", marginTop: 4 }}>
          API 키 재설정
        </button>
      </div>
    </div>
  );
}
