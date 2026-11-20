# KOKO Studio (โปรแกรมตู้ถ่ายภาพ)

โปรแกรม Windows (Electron + React + TypeScript) สำหรับตู้ถ่ายภาพ: ถ่ายจากเว็บแคม/การ์ด HDMI/กล้องผ่าน USB/โฟลเดอร์/มือถือ,
เก็บรูปในเครื่อง, พิมพ์ใบเสร็จ QR, ส่งรูปขึ้นคลาวด์ KOKO Memory เบื้องหลัง และมีแกลเลอรีของแขกในเครื่องเป็นทางสำรอง

## ต้องมี
- Windows 10/11 64-bit, Node.js 24 (เวอร์ชันเดียวกับ CI), npm
- (ถ้าทดสอบสายคลาวด์) เว็บ KOKO Memory ฝั่ง Studio ที่รันอยู่ ดู README ของ repo เว็บ

## Development
```
npm ci
npm run license:keygen          # ครั้งแรก: สร้างกุญแจทดสอบใน secrets/ (ไม่ commit)
npm run license:server          # License server ทดสอบที่ 127.0.0.1:8787 (คัดลอก .env.example เป็น .env ก่อน)
npm start                       # electron-forge start (ใช้ License server ด้านบนเมื่อยังไม่ได้ build)
```
ใช้ข้อมูลแยกจากเครื่องจริงได้ด้วย `npm start -- --user-data-dir=<โฟลเดอร์ทดสอบ>`
ต่อกับเว็บแทน License server ทดสอบ: ตั้ง `KOKO_LICENSE_API_BASE_URL` และ `KOKO_LICENSE_TRUSTED_KEYS_JSON` (กุญแจสาธารณะของเว็บ) ก่อน `npm start`

## Tests
```
npm run typecheck
node --test tests/*.test.cjs     # ชุดเดียวกับ CI (.github/workflows/ci.yml)
```
ชุดย่อยมีใน `package.json` (`test:receipt`, `test:m3`, `test:round-delete` ฯลฯ)

## Production (ตัวติดตั้ง)
ที่อยู่เซิร์ฟเวอร์และกุญแจสาธารณะถูก **ฝังตอน build** (`vite.main.config.mjs`) จึงต้องตั้งก่อนสร้างตัวติดตั้ง (PowerShell):
```
$env:KOKO_LICENSE_API_BASE_URL = "https://<โดเมนเว็บจริง>"
$env:KOKO_LICENSE_TRUSTED_KEYS_JSON = '{"<key-id>":"-----BEGIN PUBLIC KEY-----..."}'
npm run make
```
ไฟล์ติดตั้งอยู่ใน `out/make/` แล้วอัปโหลดผ่านหน้า admin ของเว็บ (`/admin/koko-studio`) ทดสอบบนเครื่องสะอาดตาม `docs/DESKTOP_CLEAN_PC_TEST_CHECKLIST.md` (repo เว็บ)

## เอกสาร
- หน้างาน: `docs/RUNBOOK_ONSITE_TH.md`, QR ผ่านโดเมนตัวเองโดยไม่มี VPS: `docs/GUEST_GALLERY_TUNNEL.md`
- โครงสร้าง: `docs/ARCHITECTURE.md`, `docs/DATA_MODEL.md`, `docs/LICENSE_API_CONTRACT.md`, `docs/SECURITY.md`
- สำรองข้อมูลตู้: `scripts/backup-booth-data.ps1` · SBOM: `docs/sbom/sbom.cdx.json`
- ภาพรวมทั้งระบบ, API ของเว็บ และรายงานผลทดสอบ: repo เว็บ `docs/ARCHITECTURE.md`, `docs/TEST_REPORT_2026-11-20.md`
