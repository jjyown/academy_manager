# Regrade Fixtures

이 디렉터리는 full regrade 오류 시나리오 재현용 샘플 파일입니다.

## 파일 설명
- `no_images.zip`: ZIP은 정상이나 이미지가 없어 "이미지 0건" 경로를 재현
- `empty.zip`: ZIP 안에 파일이 전혀 없어 "빈 ZIP" 경로를 재현
- `not_a_zip.bin`: ZIP이 아닌 파일로 "ZIP 형식 오류" 경로를 재현

## 사용 방법(권장)
1. 테스트 제출 데이터를 생성할 때 위 파일을 원본 제출물로 업로드
2. `/api/results/{id}/regrade`(full regrade 경로) 호출
3. HTTP 코드/메시지/진행률/프론트 토스트를 함께 기록
