# Milestone 2.2: Local Photo Storage Foundation

วันที่: 30 กันยายน 2026  
สถานะ: โค้ดและ automated checks ผ่าน; ยังต้องทดสอบ Settings/folder picker และ disk/restart บน Windows ก่อนปิด milestone

## สิ่งที่เพิ่ม

- เพิ่ม PhotoStore ใน Main สำหรับโฟลเดอร์ที่ผู้ดูแลเลือก
- สร้างโฟลเดอร์ photos และ metadata index รุ่นที่ 1 พร้อมตรวจความพร้อมเขียนด้วย probe file
- เขียน JPEG ลง temporary file แบบ exclusive access, fsync, แล้ว rename ไปเป็นชื่อ UUID
- บันทึกขนาดภาพ, MIME, SHA-256 และเวลาบันทึกใน manifest ที่เขียนแบบ temp + fsync + atomic rename
- serialize การเขียนภายใน process เดียว ป้องกัน capture พร้อมกันทำให้ metadata entry หาย
- แสดงจำนวนภาพ ไฟล์ orphan/temp และไฟล์ที่ไม่มีใน index เป็นสถานะต้องตรวจสอบ; ยังไม่รับไฟล์กู้คืนเข้า gallery อัตโนมัติ
- ให้ Main ตรวจ JPEG signature, ขนาด segment และ resolution ก่อน decode ด้วย Electron nativeImage
- เพิ่ม IPC แบบจำกัด: อ่านสถานะ storage, เปิด system folder picker, และรับ JPEG ขนาดจำกัดเพื่อบันทึก
- Renderer ได้รับเฉพาะชื่อโฟลเดอร์/จำนวน/metadata ภาพ ไม่มี path หรือ File System access
- ไม่ได้เพิ่ม capture button; ไม่มีภาพใดถูกบันทึกจนผู้ดูแลเลือก storage root และ source ในอนาคตส่งภาพจริงผ่าน IPC

## วิธีทดสอบ

1. ไปที่ Settings แล้วเลือกโฟลเดอร์จัดเก็บภาพที่ผู้ดูแลเตรียมไว้
2. ตรวจว่ามี photos และ photo-index.json และ UI แสดงชื่อโฟลเดอร์
3. เมื่อ Camera source และ capture UI พร้อม ให้ถ่ายภาพแล้วตรวจ UUID JPEG, ขนาด, SHA-256 และ index
4. ตรวจสถานะภาพเมื่อเปิดแอปใหม่; ย้าย/เพิ่ม UUID JPEG ที่ไม่มีใน index เพื่อดู pending recovery
5. ปิด process ระหว่าง temporary write หรือระหว่าง rename/index แล้วตรวจ recovery status
6. ตรวจโฟลเดอร์ที่เขียนไม่ได้, index เสีย, JPEG เสีย/ขนาดเกิน, และที่เก็บที่ถูกถอดออก

## Automated checks

- npm.cmd run test:storage — ผ่าน 6 กรณี ครอบคลุม storage setup, bytes/checksum, concurrent saves, orphan/temp recovery, manifest เสีย, drive root และ JPEG dimensions/header validation
- npm.cmd run typecheck — ผ่าน
- npm.cmd run package — ผ่านบน Windows x64
- การทดสอบจริงบน Windows กับ folder picker, disk-full, restart และ JPEG จากกล้องยังต้องทำแยกจาก automated checks

## ขอบเขตและข้อจำกัด

- M2.2 นี้เก็บ metadata เป็น JSON index เพื่อลด dependency; ตรวจขนาดและความเร็วเมื่อมีภาพจำนวนมากก่อนเปิดงานอีเวนต์ใหญ่ ถ้าไม่ผ่านให้ย้าย repository ไป SQLite พร้อม migration โดยไม่เปลี่ยน IPC contract
- rename รูปภาพกับ manifest เป็นสองขั้นตอน; crash ระหว่างขั้นจะปรากฏเป็น pending recovery และต้องมี review/import workflow ก่อนนับว่ากู้คืนแล้ว
- fsync และ atomic rename ลดความเสี่ยง แต่ไม่ได้ทดแทน backup ของ drive หรือรับประกันกรณี hardware/driver cache สูญหาย
- ยังไม่ผูก photo กับ event/session เพราะจะทำใน M3
- ยังไม่มี Camera SDK, shutter, countdown, gallery, auto recovery/import, template, printing, cloud, licensing หรือ payment
- ไม่ได้แก้ C:\KOKOwedding

## ไฟล์ที่แตะใน M2.2

- src/main/services/photo-store.ts
- src/main/services/jpeg-image.ts
- src/main/index.ts
- src/shared/contract.ts
- src/preload/index.ts
- src/renderer/main.tsx
- src/renderer/style.css
- package.json
- tests/photo-store.test.cjs
- docs/MILESTONE_2_2_LOCAL_STORAGE.md
