# Milestone 2.1: Camera Manager

วันที่: 30 กันยายน 2026  
โครงการ: `D:\pKOKO`

## สิ่งที่ทำ

- เพิ่ม `CameraAdapter` และ `CameraManager` แยกจาก React UI สำหรับค้นหาอุปกรณ์วิดีโอ เชื่อมต่อ ตัดการเชื่อมต่อ เริ่ม/หยุด preview และรายงานสถานะ
- เพิ่ม `BrowserCameraAdapter` ที่ใช้ `navigator.mediaDevices.enumerateDevices()`, `getUserMedia()` และ `devicechange` ตามความสามารถ Web MediaDevices/UVC ของ Chromium
- แสดงอุปกรณ์ที่ตรวจพบ ให้เลือกกล้อง และเริ่ม preview หลังผู้ใช้กดปุ่มเพื่อขอสิทธิ์กล้อง
- แสดงสถานะค้นหา พบกล้อง ไม่พบกล้อง กำลังเชื่อมต่อ พร้อมใช้งาน ไม่ได้รับอนุญาต ถูกถอดออก และข้อผิดพลาด ทั้งภาษาไทยและอังกฤษ
- หยุด MediaStream tracks เมื่อหยุด preview, เปลี่ยนอุปกรณ์, ตรวจพบว่าอุปกรณ์ที่เลือกหายไป หรือออกจาก Overview และเพิกเฉยต่อผลการเชื่อมต่อที่ล้าสมัย
- คง permission handler ของ Main ที่อนุญาตเฉพาะ video จาก main frame ของแอป รวมถึง `contextIsolation`, `nodeIntegration: false` และ `sandbox`
- คงหน้าภาพรวม Settings, ภาษาไทย/อังกฤษ, High Contrast และ Fullscreen
- ปิดเส้นทางถ่าย/บันทึกภาพใน UI และ IPC จนกว่าจะกำหนดขั้นตอนกับตำแหน่งจัดเก็บภาพอย่างชัดเจน
- interface รองรับ `captureStill?` เฉพาะ adapter ที่เพิ่มความสามารถจริง; Browser adapter ปัจจุบันไม่ได้ประกาศความสามารถนี้

## วิธีทดสอบด้วยตนเอง

1. เริ่มด้วย `npm.cmd start` หรือเปิดแอปที่ package แล้ว
2. ไปหน้า Overview: สถานะเริ่มค้นหาและแสดงรายการ video input ที่ Chromium มองเห็น
3. กด **เปิดภาพตัวอย่าง / Start preview** เพื่อให้ระบบขอสิทธิ์กล้อง จากนั้นตรวจภาพจริงและสถานะพร้อมใช้งาน
4. เมื่อมีกล้องหลายตัว เลือกอุปกรณ์อื่นและตรวจว่า preview เปลี่ยนตามอุปกรณ์ที่เลือก
5. ปฏิเสธ permission หรือปิด permission ใน Windows แล้วตรวจสถานะไม่ได้รับอนุญาต
6. ถอดกล้องขณะ preview และตรวจว่า stream หยุดและ UI ตอบสนอง; กลับมาเสียบใหม่เพื่อตรวจการค้นหาอีกครั้ง
7. ไป Settings ตรวจภาษา High Contrast และ Fullscreen แล้วยืนยันว่าใช้งานได้เช่นเดิม
8. หยุด preview หรือออกจาก Overview แล้วตรวจว่ากล้องไม่ถูกแอปใช้งานต่อ

## ผลการตรวจสอบรอบพัฒนา

- Git: ไม่สามารถตรวจ `git status` หรือ `git diff` ได้ เพราะ `D:\pKOKO` ไม่มี `.git`; จึงเก็บไฟล์เดิมไว้และตรวจรายการที่แก้ด้วยการอ่านโค้ดแทน
- Automated: `npm.cmd run typecheck` ผ่าน; `npm.cmd run package` ผ่านบน Windows x64 หลัง Forge ดาวน์โหลด Electron runtime สำเร็จ (ครั้งแรกใน sandbox ล้มเหลวที่ fetch runtime)
- Runtime UI: `npm.cmd start` สร้าง Main/Preload/Renderer ได้ แต่ไม่สามารถยืนยันหน้าต่างผ่านเครื่องมือ UI ใน session นี้ได้; จึงยังไม่ถือว่าทดสอบกรณีไม่มีกล้องผ่าน
- อุปกรณ์จริง: ยังไม่มีผลยืนยันจาก webcam/Canon/Sony ในรอบนี้; ต้องบันทึกแยกจากผล build และ typecheck
- ไม่มี test/lint script ใน `package.json`

## ข้อจำกัด

- ตรวจพบได้เฉพาะอุปกรณ์วิดีโอที่ Electron/Chromium และระบบปฏิบัติการเปิดให้ใช้ผ่าน Web MediaDevices; รายชื่อและ label อาจว่างหรือจำกัดก่อนอนุญาตสิทธิ์
- การเห็น Canon/Sony เป็น video input หรือได้ภาพ preview ไม่ได้ยืนยันการควบคุมกล้อง, remote shutter, การตั้งค่ากล้อง หรือคุณภาพเทียบการ capture ด้วย SDK
- การเชื่อมต่อ USB/Wi-Fi ทำได้เฉพาะเมื่อระบบแสดงกล้องนั้นเป็น video input ที่ Chromium ใช้ได้; ยังไม่ได้ตรวจรุ่นกล้อง
- สถานะพร้อมใช้งานหมายถึงมี MediaStream จริงจาก adapter นี้เท่านั้น

## ยังไม่ได้ทำ

- `captureStill` ใน Browser adapter, การบันทึกภาพ, gallery หรือการกำหนดตำแหน่งจัดเก็บ
- Canon EDSDK/CCAPI, Sony Camera Remote SDK, native module หรือการปรับ Installer
- Countdown, Template, Event Management, QR, Printing, Cloud Sync, License และ Auto Update
- การเปลี่ยนแปลงใน `C:\KOKOwedding`


