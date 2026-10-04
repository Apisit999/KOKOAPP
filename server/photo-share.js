(() => {
  const status = document.querySelector('#status');
  const folder = document.querySelector('#folder');
  const photosElement = document.querySelector('#photos');
  const match = location.hash.slice(1).match(/^([0-9a-f-]{36})\.([A-Za-z0-9_-]{40,128})$/i);
  if (!match) { status.textContent = 'ลิงก์โฟลเดอร์ไม่ถูกต้อง หรือรหัสเจ้าของหายไป'; return; }
  const [, folderId, ownerKey] = match;
  const headers = { authorization: `Bearer ${ownerKey}` };
  fetch(`/v1/public/photo-folders/${folderId}`, { headers, cache: 'no-store' })
    .then(async response => {
      if (!response.ok) throw new Error('เปิดโฟลเดอร์นี้ไม่ได้ ตรวจลิงก์หรือขอรหัสจากเจ้าของภาพ');
      return response.json();
    })
    .then(data => {
      document.querySelector('#folder-name').textContent = data.label;
      document.querySelector('#album-expiry').textContent = `This private album expires on ${new Date(data.expiresAt).toLocaleDateString()}.`;
      const videos = Array.isArray(data.videos) ? data.videos : [];
      document.querySelector('#photo-count').textContent = `${data.photos.length} ภาพ · ${videos.length} วิดีโอ`;
      for (const photo of data.photos) {
        const card = document.createElement('article');
        const image = document.createElement('img');
        image.alt = 'ภาพถ่าย';
        image.loading = 'lazy';
        const link = document.createElement('a');
        link.textContent = 'ดาวน์โหลดภาพ ↓';
        link.download = `${photo.id}.jpg`;
        card.append(image, link);
        photosElement.append(card);
        fetch(`/v1/public/photo-folders/${folderId}/photos/${photo.id}`, { headers, cache: 'no-store' })
          .then(response => { if (!response.ok) throw new Error('download failed'); return response.blob(); })
          .then(blob => { const objectUrl = URL.createObjectURL(blob); image.src = objectUrl; link.href = objectUrl; })
          .catch(() => { image.alt = 'โหลดภาพนี้ไม่ได้'; link.remove(); });
      }
      for (const video of videos) {
        const card = document.createElement('article');
        const player = document.createElement('video');
        player.controls = true;
        player.playsInline = true;
        player.preload = 'none';
        player.hidden = true;
        player.setAttribute('aria-label', 'วิดีโอ');
        const playButton = document.createElement('button');
        playButton.type = 'button';
        playButton.textContent = '▶ เปิดวิดีโอ';
        playButton.setAttribute('aria-label', 'เปิดวิดีโอ');
        const link = document.createElement('a');
        link.textContent = 'ดาวน์โหลดวิดีโอ ↓';
        link.download = `${video.id}.webm`;
        let objectUrl = '';
        let loading = null;
        const loadVideo = () => {
          if (objectUrl) return Promise.resolve(objectUrl);
          if (!loading) loading = fetch(`/v1/public/photo-folders/${folderId}/videos/${video.id}`, { headers, cache: 'no-store' })
            .then(response => { if (!response.ok) throw new Error('download failed'); return response.blob(); })
            .then(blob => { objectUrl = URL.createObjectURL(blob); player.src = objectUrl; player.hidden = false; playButton.remove(); link.href = objectUrl; return objectUrl; })
            .catch(error => { loading = null; throw error; });
          return loading;
        };
        playButton.addEventListener('click', () => { void loadVideo().then(() => player.play()).catch(() => { playButton.textContent = 'โหลดวิดีโอไม่สำเร็จ · ลองอีกครั้ง'; }); });
        link.addEventListener('click', event => {
          if (objectUrl) return;
          event.preventDefault();
          void loadVideo().then(() => { link.click(); }).catch(() => { link.textContent = 'ดาวน์โหลดไม่สำเร็จ · ลองอีกครั้ง'; });
        });
        card.append(playButton, player, link);
        photosElement.append(card);
      }
      status.hidden = true;
      folder.hidden = false;
    })
    .catch(error => { status.textContent = error.message; });
})();
