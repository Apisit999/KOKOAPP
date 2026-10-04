# แผนรองรับกล้องถ่ายรูปหลายรุ่น

อัปเดตลำดับงาน: เริ่ม [Webcam Photobooth](WEBCAM_PHOTOBOOTH_WORK_PLAN.md) ให้ใช้งานจริงก่อน เพราะยังไม่มีกล้อง Canon/Sony สำหรับทดสอบ เอกสารนี้เป็นแผนสำหรับขยายอุปกรณ์ภายหลัง

วันที่: 30 กันยายน 2026  
สถานะ: ออกแบบ; ยังไม่ทราบรุ่น Canon/Sony ของผู้ใช้และยังไม่รับรองอุปกรณ์ใด

## วิธีเชื่อมต่อที่ประเมิน

| เส้นทาง | Preview | การถ่ายภาพ | ข้อกำหนด |
| --- | --- | --- | --- |
| Web video / UVC | เมื่อ OS/Chromium มองเห็น video input | ถ้าพัฒนา frame capture จะได้ภาพจาก video stream | ไม่เทียบเท่า shutter/download ภาพนิ่งของกล้อง |
| Canon EDSDK | ตรวจต่อรุ่น | ประเมิน shutter และ download จาก API ที่รุ่นนั้นรองรับ | ตรวจสิทธิ์ SDK, Windows/bitness และการแจกจ่าย |
| Canon CCAPI | ตรวจต่อรุ่นและ endpoint | ตรวจความสามารถจริงและการรับไฟล์ | ตรวจ firmware, การเปิดใช้ API และเครือข่าย |
| Sony Camera Remote SDK | ตรวจต่อรุ่น | ประเมิน shutter และ download ต่อรุ่น | ตรวจ supported device/interface, firmware และ SDK agreement |
| Folder import | ไม่มี preview โดยตัว watcher | รับไฟล์ที่โปรแกรม tethering สร้างเสร็จแล้ว | ไม่ได้สั่ง shutter; ตรวจไฟล์สมบูรณ์และ duplicate |
| HDMI capture device | ได้ video input เมื่อ capture device รองรับ | frame capture เท่านั้น เว้นแต่มี control adapter แยก | HDMI video ไม่ใช่เส้นทางสั่ง shutter |

Canon เผยแพร่ EDSDK และ CCAPI สำหรับกล้องที่เลือกไว้ โดยต้องตรวจรุ่นกับความสามารถของ API ก่อนใช้ ดู [Canon Asia Camera API Package](https://asia.canon/en/campaign/developerresources/camera/cap) และ [Canon: ความต่างของ EDSDK/CCAPI](https://developercommunity.usa.canon.com/s/article/What-is-the-difference-between-CCAPI-and-EDSDK)

Sony มีรายการรุ่น ระบบปฏิบัติการ และ interface ของ Camera Remote SDK; แม้หน้า SDK ระบุ USB/LAN/Wi-Fi แต่ต้องตรวจ API reference ของอุปกรณ์นั้นก่อนสรุปวิธีเชื่อมต่อ ดู [Sony Camera Remote SDK](https://support.d-imaging.sony.co.jp/app/sdk/en/index.html)

รายการผู้ผลิตเป็นหลักฐานความเป็นไปได้ ผลทดสอบ KOKO เป็นหลักฐานการรับรองผลิตภัณฑ์ ต้องเก็บทั้งสองอย่างแยกกัน

## สถานะโค้ดปัจจุบัน

Browser camera adapter ระบุความสามารถชัดเจนว่าเป็น `video-input`: ดูภาพสดและบันทึกเฟรมจากวิดีโอได้ แต่ไม่มี remote shutter และไม่ได้รับประกันไฟล์ภาพต้นฉบับจากกล้องถ่ายรูป อุปกรณ์ที่ระบบปฏิบัติการแสดงเป็น video input เช่น webcam หรือโทรศัพท์ที่ทำงานเป็น webcam ใช้เส้นทางนี้ได้ ส่วนโทรศัพท์ที่ไม่แสดงเป็น video input ยังต้องมีตัวเชื่อมแบบเครือข่ายแยกต่างหาก

หน้าจอแขกเรียก capture flow เดียวกับ Capture Studio และแสดงข้อจำกัดของ video-frame capture ชัดเจน การเพิ่ม source ในอนาคตให้ทำ adapter ที่ประกาศ `sourceKind`, `livePreview`, `stillCapture` และ `remoteShutter` ตามความสามารถจริง ห้ามถือว่ากล้องทุกชนิดรองรับคำสั่งถ่ายหรือคุณภาพเท่ากัน

## สัญญา Camera Service เป้าหมาย

`CameraDescriptor`: source ID, adapter ID, device identity, model/firmware เมื่ออ่านได้, transport และสถานะการทดสอบ ห้ามเดายี่ห้อหรือรุ่นจากชื่อ video input แล้วเปิด capability เพิ่ม

`CameraCapabilities`: preview type, still capture mode (`none`, `video-frame`, `camera-original`, `file-import`), remote shutter, file download, resolution negotiation, exposure controls และ reconnect support แสดงเฉพาะสิ่งที่ adapter ตรวจพบจริง

| คำสั่ง | ผลลัพธ์และข้อกำหนด |
| --- | --- |
| enumerateDevices | descriptor ของอุปกรณ์ที่ตรวจพบ; ผลไม่เท่ากับ connected |
| connect / disconnect | connection session ID และสถานะ; ยกเลิกผลเก่าและคืนทรัพยากร |
| startPreview / stopPreview | handle ที่มี type ชัดเจน เช่น MediaStream หรือ controlled frame channel |
| captureStill | มีเฉพาะ adapter ที่รองรับ; คืน operation ID และผลไฟล์จริง พร้อม source mode |
| cancelOperation | ยกเลิกเมื่อ adapter ทำได้; ถ้าหยุด shutter ไม่ได้ให้รอ completion และกักผลไว้กับ operation เดิม |
| getStatus / subscribeStatus | snapshot และเหตุการณ์ disconnected, busy, permission, error; UI ไม่สร้าง connected เอง |

Capture Coordinator ตรวจ capability และ serializes shutter commands กล้องหนึ่งตัวมี capture in flight ได้หนึ่งรายการก่อนเพิ่ม concurrency ที่วัดบน hardware แล้ว

## การแยก SDK

- ทำ Canon/Sony helper process แยกจาก Renderer และกำหนด RPC ที่มี request ID, schema version, payload limit และ timeout
- Main เป็นเจ้าของ lifecycle/authentication ของ helper; Renderer ไม่มีสิทธิ์เรียก DLL หรือ filesystem
- preview frames ใช้ช่องทางข้อมูลที่มีขนาดและอัตราเฟรมจำกัด; command channel ไม่รับ binary ขนาดไม่จำกัด
- SDK crash/hang ทำให้ source unavailable และแจ้ง retry; ไม่ restart capture ที่อาจสั่ง shutter ไปแล้วแบบอัตโนมัติ
- การ download ต้องสัมพันธ์กับ operation/session ก่อนบันทึก ไม่จับไฟล์ล่าสุดจากกล้องมาเป็นผลของคำสั่งโดยเดา
- ทดสอบการปิดกล้อง ถอดสาย เครื่อง sleep และโปรแกรมอื่นจับกล้องก่อนนำไปใช้จริง

## ลำดับเลือกกล้องแรก

1. ขอรุ่นและ firmware ที่มีอยู่จริง ตรวจเอกสาร SDK/API
2. ประเมิน USB สำหรับกล้องแรก เพราะลดตัวแปรเครือข่ายระหว่างพิสูจน์ shutter/download
3. ทดสอบ official sample แยกจาก KOKO และบันทึกข้อจำกัดการติดตั้ง/แจกจ่าย
4. ทำ adapter ที่มี capability จริงเฉพาะชุดที่ผ่าน แล้วเชื่อม safe-save ของ KOKO
5. ประเมิน Wi-Fi ของรุ่นนั้นแยกต่างหาก รวม disconnect, เปลี่ยน IP และเวลารับไฟล์
6. เพิ่มกล้องแบรนด์ที่สองโดยใช้ contract เดิม แล้วตรวจว่าต้องขยาย contract อย่างมีเหตุผลหรือไม่

Folder import เป็น fallback สำหรับรุ่นที่มีโปรแกรม tethering เหมาะสม ไม่รับประกันใช้ได้กับทุกกล้อง และไม่ถือเป็น direct remote control

## Compatibility matrix

| แบรนด์/รุ่น | Firmware | OS/CPU | Adapter/version | Transport | Preview | Shutter | Original download | Reconnect | หลักฐาน | สถานะ |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Canon — รอรุ่น | รอข้อมูล | รอข้อมูล | ยังไม่เลือก | USB/Wi-Fi รอประเมิน | ยังไม่ทดสอบ | ยังไม่ทดสอบ | ยังไม่ทดสอบ | ยังไม่ทดสอบ | ไม่มี | planned |
| Sony — รอรุ่น | รอข้อมูล | รอข้อมูล | ยังไม่เลือก | USB/Wi-Fi รอประเมิน | ยังไม่ทดสอบ | ยังไม่ทดสอบ | ยังไม่ทดสอบ | ยังไม่ทดสอบ | ไม่มี | planned |

สถานะใช้ `planned`, `vendor-listed`, `lab-tested`, `event-tested`, `unsupported` พร้อมเหตุผลและวันที่ ห้ามแสดง planned/vendor-listed ว่ารับรองโดย KOKO

## โทรศัพท์: ทางขยายภายหลัง

ยังต้องเลือกระหว่างโทรศัพท์เป็น camera companion กับเปิด Photobooth บนโทรศัพท์โดยตรง ทั้งสองแบบใช้ capture/storage pipeline ร่วมได้ แต่ ownership และการใช้ออฟไลน์ต่างกัน

หากเลือก companion: จับคู่ด้วยรหัสใช้ครั้งเดียวอายุสั้น ผู้ดูแลยืนยันอุปกรณ์ ผูกกับ event/session และ revoke ได้ รับไฟล์ด้วย operation ID และ checksum พร้อม deduplicate; preview ผ่าน WebRTC เป็นแนวทางที่ต้องทดสอบ Android/iOS จริง

หน้าเว็บที่เรียกกล้องต้องอยู่ใน secure context จึงไม่ออกแบบโดยเปิด HTTP ของ IP เครื่องใน LAN แล้วถือว่าใช้กล้องโทรศัพท์ได้เสมอ ต้องเลือก HTTPS/certificate หรือ native companion ที่เหมาะสม ดู [MDN getUserMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia)

## เกณฑ์ผ่านต่อรุ่น

ทดสอบภาพจริงและคุณภาพไฟล์, ระยะเวลาชัตเตอร์ถึง safe-save, แสง/flash, แบตเตอรี่, sleep/busy, ถอด/เสียบใหม่ และงานต่อเนื่องขนาดใกล้เคียง event เป้าหมาย บันทึกจำนวนภาพ ความผิดพลาดและ p50/p95 ด้วย PC/สาย/firmware ที่ใช้จริง USB และ Wi-Fi ต้องมีผลแยกกัน
