# ✈️ longtermcare-pilot

> **Carefor Longterm-care System Automation Bot**
> 복잡한 요양 정보 시스템의 데이터 입력을 자동화하는 스마트 파일럿입니다.

## 🛠 Tech Stack

- **Runtime**: Node.js
- **Library**: Playwright / Puppeteer
- **Language**: JavaScript (ES6+)

## 📂 Project Structure

- `run.js`: 전체 자동화 프로세스 엔트리 포인트
- `contractEdit/`: 급여계약내용 메뉴 자동화 로직
  - `test1~3`: 대상자 검색 및 다중 선택
  - `test4`: 서비스 시간 자동 입력 (Tab 확정 로직)
  - `test5`: 서비스 방법 콤보박스 정밀 탐색 (모듈 기반)
  - `test6`: 최종 입력 및 저장 버튼 클릭
- `utils/`: 공용 유틸리티
  - `click/`: 넥사크로 대응 스마트 클릭
  - `combo/`: 상하 전수 탐색 콤보박스 선택 모듈

## 🚀 Getting Started

```bash
# Repository 클론
git clone [https://github.com/your-username/longtermcare-pilot.git](https://github.com/your-username/longtermcare-pilot.git)

# 의존성 설치
npm install

# 봇 실행
node run.js
```
