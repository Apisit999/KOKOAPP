# QR ให้ทุกคนโหลดรูป โดยไม่ต้องมี VPS (Cloudflare Tunnel)

แอปบนเครื่องถ่ายภาพเป็นเซิร์ฟเวอร์แกลเลอรีเอง (พอร์ต 47831) Cloudflare Tunnel ฟรี
ทำให้โดเมนของคุณชี้เข้าเครื่องนี้ได้ โดยไม่ต้องเปิดพอร์ตที่เราเตอร์

ข้อจำกัดที่ต้องรู้
- ลูกค้าโหลดรูปได้ **เฉพาะตอนที่เครื่องถ่ายภาพเปิด แอปทำงาน และมีอินเทอร์เน็ต**
- ถ้าอยากให้โหลดได้หลังจบงานตลอดโดยไม่ต้องเปิดเครื่อง ต้องใช้เซิร์ฟเวอร์ (แผน M1–M6) ซึ่งสลับมาใช้ได้ภายหลังโดยขั้นตอนของลูกค้าไม่เปลี่ยน
- ลิงก์ของแต่ละรอบเดาไม่ได้ และหมดอายุตามวันที่ตั้งในแอป (ค่าเริ่มต้น 30 วัน)

## ขั้นตอน (ทำครั้งเดียวต่อเครื่อง ประมาณ 15 นาที)

1. มีบัญชี Cloudflare (ฟรี) และย้าย DNS ของโดเมนมาที่ Cloudflare (Add a site → ใส่โดเมน → เปลี่ยน Nameserver ที่ผู้ขายโดเมนตามที่ Cloudflare บอก)
2. ติดตั้งโปรแกรม cloudflared บนเครื่องถ่ายภาพ (PowerShell):
   ```
   winget install --id Cloudflare.cloudflared
   ```
3. ล็อกอินและสร้าง Tunnel:
   ```
   cloudflared tunnel login
   cloudflared tunnel create koko-booth
   cloudflared tunnel route dns koko-booth photos.โดเมนของคุณ.com
   ```
4. สร้างไฟล์ `%USERPROFILE%\.cloudflared\config.yml`:
   ```
   tunnel: koko-booth
   credentials-file: C:\Users\<ชื่อผู้ใช้>\.cloudflared\<รหัส-tunnel>.json
   ingress:
     - hostname: photos.โดเมนของคุณ.com
       service: http://localhost:47831
     - service: http_status:404
   ```
5. ให้ Tunnel เปิดเองทุกครั้งที่เปิดเครื่อง (PowerShell แบบ Administrator):
   ```
   cloudflared service install
   ```
6. ในแอป: ตั้งค่า → "แกลเลอรีของแขก" → ใส่ `https://photos.โดเมนของคุณ.com` → เปิดแกลเลอรี → กด "ตรวจว่าเปิดจากข้างนอกได้" ต้องขึ้น ✓

## ทดสอบก่อนใช้จริง
- ถ่ายรอบทดลอง สแกน QR ด้วยมือถือที่ **ปิด Wi‑Fi ใช้ 4G/5G** ต้องเห็นรูปและกด "บันทึกทั้งหมดลงอัลบั้ม" ได้
- ลองทั้ง iPhone และ Android และเปิดจากในแอป LINE
