/**
 * 로그인/세션 관리 모듈
 */
async function loginWithSession(browser, fullUrl) {
  const sessionMatch = fullUrl.match(/SESSIONCHECK!([^&]+)/);
  if (!sessionMatch) throw new Error("유효한 SESSIONCHECK URL이 아닙니다.");

  const sessionId = sessionMatch[1];
  const context = browser.defaultBrowserContext();
  const page = await browser.newPage();

  // M1 맥북 기준 뷰포트
  await page.setViewport({ width: 1440, height: 900 });

  await context.setCookie({
    name: "JSESSIONID",
    value: sessionId,
    domain: "www.longtermcare.or.kr",
    path: "/",
    httpOnly: true,
    secure: true,
  });

  console.log("🚀 세션 접속 중...");
  await page.goto(fullUrl, { waitUntil: "networkidle2" });

  // 팝업 수동 처리 및 엔진 로딩 대기
  console.log("⏳ 초기 로딩 대기 중 (3초)...");
  await new Promise((r) => setTimeout(r, 3000));

  return page;
}

module.exports = { loginWithSession };
