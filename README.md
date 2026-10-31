# Pixform — Chuyển định dạng ảnh

Web app chuyển đổi định dạng ảnh ngay trên trình duyệt:

- Tải lên **nhiều ảnh** cùng lúc (chọn file, kéo thả hoặc dán Ctrl+V)
- **Tự nhận định dạng thật** của từng file từ nội dung (magic bytes), không tin vào đuôi file —
  ví dụ file `anh.jpg` nhưng thực chất là PNG sẽ được báo rõ
- Chọn định dạng đích chung cho tất cả, hoặc đổi riêng từng file
- Chỉnh chất lượng (JPG, WebP, AVIF) và màu nền thay vùng trong suốt (JPG, BMP)
- Xem dung lượng trước/sau và % thay đổi
- Tải từng file, tải lần lượt tất cả, hoặc gộp thành **ZIP**
- Giao diện sáng / tối (mặc định theo hệ điều hành, ghi nhớ lựa chọn)

## Định dạng

| Đọc (đầu vào) | Ghi (đầu ra) |
| --- | --- |
| PNG, JPG, WebP, AVIF, GIF, BMP, ICO, TIFF, HEIC/HEIF, SVG | WebP, PNG, JPG, AVIF, GIF, BMP, ICO, TIFF |

- **WebP / AVIF**: dùng encoder có sẵn của trình duyệt; nếu trình duyệt không hỗ trợ (Safari với WebP,
  hầu hết trình duyệt với AVIF) thì tự chuyển sang encoder WebAssembly (`@jsquash/webp`, `@jsquash/avif`).
- **HEIC** (ảnh iPhone): giải mã bằng `heic2any`. **TIFF**: đọc/ghi bằng `utif`.
- **GIF**: lượng tử hoá còn 256 màu (`gifenc`), giữ vùng trong suốt.
- **ICO**: favicon vuông nhiều cỡ 16, 32, 48, 256px (PNG bên trong).
- **BMP**: 24-bit, đọc được ở mọi nơi.
- Ảnh động (GIF, WebP động) chỉ giữ khung đầu. SVG được raster hoá theo kích thước khai báo trong file.
- File PSD, JPEG XL, PDF được nhận diện nhưng chưa hỗ trợ đọc.

Các thư viện nặng (HEIC, AVIF, WebP wasm, TIFF) chỉ tải khi thật sự cần.

## Riêng tư

File **không được tải lên máy chủ** và không có database: mọi xử lý chạy trên trình duyệt.

## Cấu trúc

```
src/
  App.tsx              # Giao diện: tải lên, chọn định dạng, danh sách file, tải về
  components/Icon.tsx
  lib/formats.ts       # Danh sách định dạng + nhận diện bằng magic bytes
  lib/decode.ts        # Giải mã ảnh (trình duyệt, HEIC, TIFF, SVG)
  lib/encode.ts        # Mã hoá ảnh (canvas, WebP/AVIF wasm, GIF, BMP, ICO, TIFF)
  lib/download.ts      # Tải file, đóng gói ZIP (fflate)
  lib/theme.ts         # Giao diện sáng/tối
api/health.py          # Python serverless function (Vercel) – GET /api/health
```

## Chạy local

```bash
npm install
npm run dev
```

Mở http://localhost:5173. Để chạy cả Python function local: `npx vercel dev`.

## Deploy Vercel

1. Đẩy code lên GitHub, rồi **Import Project** trên vercel.com (framework tự nhận Vite theo `vercel.json`), hoặc
2. Dùng CLI: `npx vercel` (preview) / `npx vercel --prod` (production).

Không cần biến môi trường. `api/health.py` chỉ dùng thư viện chuẩn của Python.
