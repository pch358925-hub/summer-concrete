# 서중 콘크리트 습윤양생 사진대지

카톡방에 링크를 공유하고, 모바일이나 PC에서 1일차부터 5일차까지 습윤양생 사진을 등록한 뒤 A4 사진대지로 출력하는 웹앱입니다.

## 주요 기능

- 현장명 기본값: `세종천안 2공구 (주)서화`
- 타설부위 직접 입력
- 타설부위 예시: `금단구 A1(사천) 벽체 1단`
- 최근 3개월 사진대지 목록
- 월별 사진대지 목록 필터
- 1일차~5일차 사진 등록 상태 확인
- 사진 업로드 시 자동 JPEG 압축
- 출력 양식 오른쪽 칸: `1일차`, `2일차`, `3일차`, `4일차`, `5일차`
- 출력 행 이름: `위치`, `사진내용`
- 사진 출력 크기: `120mm x 80mm`

## 지금 바로 확인

`index.html`을 브라우저로 열면 로컬 모드로 실행됩니다.

로컬 모드는 같은 PC와 같은 브라우저 안에서만 저장됩니다. 카톡방에 링크를 공유해서 여러 사람이 같이 올리려면 Supabase 설정이 필요합니다.

## 실시간 공유 설정

1. Supabase 프로젝트를 만듭니다.
2. SQL Editor에서 `supabase-schema.sql` 내용을 실행합니다.
3. Project Settings > API에서 Project URL과 anon public key를 복사합니다.
4. `config.js`에 값을 입력합니다.

```js
window.CONCRETE_PHOTO_CONFIG = {
  supabaseUrl: "https://YOUR_PROJECT.supabase.co",
  supabaseAnonKey: "YOUR_SUPABASE_ANON_KEY",
  bucket: "curing-photos",
};
```

5. 이 폴더를 Netlify, Vercel, GitHub Pages 같은 정적 호스팅에 올립니다.
6. 생성된 사이트 링크를 카톡방에 공유합니다.

## 현재 세팅 상태

- `config.js`에는 Supabase 연결값이 입력되어 있습니다.
- `photo_boards`, `photo_entries` 테이블 연결은 확인되었습니다.
- 사진 저장용 Storage 버킷 `curing-photos`가 없으면 업로드가 실패합니다.
- 이 경우 Supabase SQL Editor에서 `supabase-storage-setup.sql`만 실행하면 됩니다.

## 무료 링크 배포 추천

가장 단순한 무료 배포는 GitHub Pages입니다.

1. 이 폴더의 `index.html`, `styles.css`, `app.js`, `config.js`를 GitHub 저장소에 올립니다.
2. GitHub 저장소의 Settings > Pages에서 `main` 브랜치와 `/root`를 선택합니다.
3. 발급된 `https://계정명.github.io/저장소명/` 주소를 엽니다.
4. `새 대지`를 눌러 타설부위별 공유 링크를 만들고 카톡방에 공유합니다.

## 사용 흐름

1. `새 대지`를 눌러 타설부위별 링크를 만듭니다.
2. 타설부위와 타설일을 입력합니다.
3. 링크를 카톡방에 공유합니다.
4. 현장 담당자가 모바일에서 `촬영` 또는 `첨부`로 사진을 등록합니다.
5. 상단 `사진대지 목록`에서 최근 3개월 등록 현황을 확인합니다.
6. `인쇄/PDF`를 눌러 사진대지를 출력합니다.

## 사진 용량

원본 사진을 그대로 저장하지 않고, 업로드 전 브라우저에서 긴 변 기준 최대 1600px 수준으로 줄이고 JPEG 품질을 낮춰 저장합니다. 출력 사진 크기 `120mm x 80mm` 기준으로는 현장 출력물에 충분한 수준입니다.

대략 1장당 300KB~900KB 정도를 예상하면, 3개월치 450장 기준 약 135MB~405MB 정도입니다. 실제 운영 전에는 Supabase 요금제의 Storage 용량을 확인해야 합니다.

## 운영 때 보강하면 좋은 것

- 현장별 PIN 번호
- 관리자만 삭제 가능
- 완료된 사진대지 PDF 자동 저장
- 원본 사진 별도 보관 여부 선택
